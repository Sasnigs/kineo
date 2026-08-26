#!/bin/bash

set -euo pipefail

readonly EXPECTED_ARGUMENT_COUNT="2"
readonly APP_BUNDLE_IDENTIFIER="app.kineo.prototype"
readonly APP_EXECUTABLE_NAME="Kineo"
readonly LAUNCH_SETTLE_SECONDS="2"

if [[ "$#" != "$EXPECTED_ARGUMENT_COUNT" ]]; then
    printf 'Usage: %s <simulator-id> <app-bundle-path>\n' "$0" >&2
    exit 1
fi

readonly SIMULATOR_ID="$1"
readonly APP_BUNDLE_PATH="$2"

[[ -d "$APP_BUNDLE_PATH" ]] || {
    printf 'Simulator launch check failed: app bundle does not exist at %s\n' "$APP_BUNDLE_PATH" >&2
    exit 1
}

# The app may not be installed yet, so termination is intentionally best effort.
xcrun simctl terminate "$SIMULATOR_ID" "$APP_BUNDLE_IDENTIFIER" >/dev/null 2>&1 || true
xcrun simctl install "$SIMULATOR_ID" "$APP_BUNDLE_PATH"
xcrun simctl launch "$SIMULATOR_ID" "$APP_BUNDLE_IDENTIFIER" >/dev/null
sleep "$LAUNCH_SETTLE_SECONDS"

installed_container="$(xcrun simctl get_app_container \
    "$SIMULATOR_ID" \
    "$APP_BUNDLE_IDENTIFIER" \
    app)"
installed_executable="$installed_container/$APP_EXECUTABLE_NAME"

if ! ps -ax -o command= | grep -Fxq "$installed_executable"; then
    printf 'Simulator launch check failed: Kineo terminated after launch.\n' >&2
    exit 1
fi

printf 'Simulator launch verified: the clean InternalPrototype app remains running.\n'
