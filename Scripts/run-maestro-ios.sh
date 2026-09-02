#!/bin/bash

set -euo pipefail

readonly EXPECTED_ARGUMENT_COUNT=3
readonly EXIT_USAGE=64
readonly EXIT_MISSING_INPUT=66
readonly EXIT_UNAVAILABLE=69
readonly KINEO_BUNDLE_ID="app.kineo.expo.prototype"
readonly DEFAULT_CONTENT_SIZE="large"
readonly DEFAULT_APPEARANCE="light"
readonly DEFAULT_INCREASE_CONTRAST="disabled"
readonly UI_WAIT_TIMEOUT_MILLISECONDS=15000
readonly UI_SCROLL_TIMEOUT_MILLISECONDS=45000
readonly UI_SCROLL_SPEED=80

if [[ $# -ne $EXPECTED_ARGUMENT_COUNT ]]; then
  printf 'Usage: %s <simulator-id> <app-path> <maestro-bin>\n' "$0" >&2
  exit "$EXIT_USAGE"
fi

readonly SIMULATOR_ID="$1"
readonly APP_PATH="$2"
readonly MAESTRO_BIN="$3"
readonly FLOW_ROOT="$(cd "$(dirname "$0")/../apps/mobile/.maestro" && pwd)"
readonly CONTENT_SIZE="${KINEO_SIMULATOR_CONTENT_SIZE:-$DEFAULT_CONTENT_SIZE}"
readonly APPEARANCE="${KINEO_SIMULATOR_APPEARANCE:-$DEFAULT_APPEARANCE}"
readonly INCREASE_CONTRAST="${KINEO_SIMULATOR_INCREASE_CONTRAST:-$DEFAULT_INCREASE_CONTRAST}"

if [[ ! -d "$APP_PATH" ]]; then
  printf 'Kineo app bundle does not exist at %s.\n' "$APP_PATH" >&2
  exit "$EXIT_MISSING_INPUT"
fi

if [[ ! -x "$MAESTRO_BIN" ]]; then
  printf 'Maestro executable does not exist at %s.\n' "$MAESTRO_BIN" >&2
  exit "$EXIT_UNAVAILABLE"
fi

xcrun simctl ui "$SIMULATOR_ID" content_size "$CONTENT_SIZE"
xcrun simctl ui "$SIMULATOR_ID" appearance "$APPEARANCE"
xcrun simctl ui "$SIMULATOR_ID" increase_contrast "$INCREASE_CONTRAST"
if xcrun simctl get_app_container "$SIMULATOR_ID" "$KINEO_BUNDLE_ID" app >/dev/null 2>&1; then
  xcrun simctl uninstall "$SIMULATOR_ID" "$KINEO_BUNDLE_ID"
fi
xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"

export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
"$MAESTRO_BIN" test \
  -e UI_WAIT_TIMEOUT_MILLISECONDS="$UI_WAIT_TIMEOUT_MILLISECONDS" \
  -e UI_SCROLL_TIMEOUT_MILLISECONDS="$UI_SCROLL_TIMEOUT_MILLISECONDS" \
  -e UI_SCROLL_SPEED="$UI_SCROLL_SPEED" \
  --device "$SIMULATOR_ID" \
  "${FLOW_ROOT}/first-use-routine.yaml" \
  "${FLOW_ROOT}/attention-correction.yaml" \
  "${FLOW_ROOT}/interruption-and-safety.yaml"
