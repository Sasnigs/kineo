#!/bin/bash

set -euo pipefail

readonly EXPECTED_ARGUMENT_COUNT="3"
readonly APP_BUNDLE_IDENTIFIER="app.kineo.expo.prototype"
readonly APP_EXECUTABLE_NAME="Kineo"
readonly SCREEN_CHECK_ATTEMPTS="15"
readonly SCREEN_CHECK_INTERVAL_SECONDS="1"
readonly SCRIPT_DIRECTORY="$(cd "$(dirname "$0")" && pwd)"

if [[ "$#" != "$EXPECTED_ARGUMENT_COUNT" ]]; then
    printf 'Usage: %s <simulator-id> <app-bundle-path> <expected-screen-text>\n' "$0" >&2
    exit 1
fi

readonly SIMULATOR_ID="$1"
readonly APP_BUNDLE_PATH="$2"
readonly EXPECTED_SCREEN_TEXT="$3"

[[ -d "$APP_BUNDLE_PATH" ]] || {
    printf 'Simulator launch check failed: app bundle does not exist at %s\n' "$APP_BUNDLE_PATH" >&2
    exit 1
}

# A clean uninstall intentionally removes stale simulator data before this launch gate.
xcrun simctl uninstall "$SIMULATOR_ID" "$APP_BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
xcrun simctl install "$SIMULATOR_ID" "$APP_BUNDLE_PATH"
xcrun simctl launch "$SIMULATOR_ID" "$APP_BUNDLE_IDENTIFIER" >/dev/null

temporary_directory="$(mktemp -d -t kineo-simulator-launch)"
trap 'rm -rf "$temporary_directory"' EXIT
readonly SCREENSHOT_PATH="$temporary_directory/screen.png"
readonly SCREEN_ASSERTION_EXECUTABLE="$temporary_directory/assert-simulator-screen"

xcrun swiftc \
    -module-cache-path "$temporary_directory/swift-module-cache" \
    "$SCRIPT_DIRECTORY/assert-simulator-screen.swift" \
    -o "$SCREEN_ASSERTION_EXECUTABLE"

screen_verified="false"
last_screen_output=""
for ((attempt = 1; attempt <= SCREEN_CHECK_ATTEMPTS; attempt += 1)); do
    xcrun simctl io "$SIMULATOR_ID" screenshot "$SCREENSHOT_PATH" >/dev/null 2>&1
    if last_screen_output="$("$SCREEN_ASSERTION_EXECUTABLE" \
        "$SCREENSHOT_PATH" \
        "$EXPECTED_SCREEN_TEXT" 2>&1)"; then
        screen_verified="true"
        break
    fi
    sleep "$SCREEN_CHECK_INTERVAL_SECONDS"
done

if [[ "$screen_verified" != "true" ]]; then
    printf 'Simulator launch check failed: expected screen content did not appear. %s\n' \
        "$last_screen_output" >&2
    exit 1
fi

installed_container="$(xcrun simctl get_app_container \
    "$SIMULATOR_ID" \
    "$APP_BUNDLE_IDENTIFIER" \
    app)"
installed_executable="$installed_container/$APP_EXECUTABLE_NAME"

if ! ps -ax -o command= | grep -Fx "$installed_executable" >/dev/null; then
    printf 'Simulator launch check failed: Kineo terminated after launch.\n' >&2
    exit 1
fi

printf 'Simulator launch verified: the clean Expo app rendered its expected first screen.\n'
