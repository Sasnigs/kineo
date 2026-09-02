#!/bin/bash

set -euo pipefail

readonly EXPECTED_ARGUMENT_COUNT=3
readonly KINEO_BUNDLE_ID="app.kineo.expo.prototype"
readonly DEFAULT_CONTENT_SIZE="large"
readonly DEFAULT_APPEARANCE="light"

if [[ $# -ne $EXPECTED_ARGUMENT_COUNT ]]; then
  printf 'Usage: %s <simulator-id> <app-path> <maestro-bin>\n' "$0" >&2
  exit 64
fi

readonly SIMULATOR_ID="$1"
readonly APP_PATH="$2"
readonly MAESTRO_BIN="$3"
readonly FLOW_ROOT="$(cd "$(dirname "$0")/../apps/mobile/.maestro" && pwd)"

if [[ ! -d "$APP_PATH" ]]; then
  printf 'Kineo app bundle does not exist at %s.\n' "$APP_PATH" >&2
  exit 66
fi

if [[ ! -x "$MAESTRO_BIN" ]]; then
  printf 'Maestro executable does not exist at %s.\n' "$MAESTRO_BIN" >&2
  exit 69
fi

xcrun simctl ui "$SIMULATOR_ID" content_size "$DEFAULT_CONTENT_SIZE"
xcrun simctl ui "$SIMULATOR_ID" appearance "$DEFAULT_APPEARANCE"
if xcrun simctl get_app_container "$SIMULATOR_ID" "$KINEO_BUNDLE_ID" app >/dev/null 2>&1; then
  xcrun simctl uninstall "$SIMULATOR_ID" "$KINEO_BUNDLE_ID"
fi
xcrun simctl install "$SIMULATOR_ID" "$APP_PATH"

export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
"$MAESTRO_BIN" test \
  --device "$SIMULATOR_ID" \
  "${FLOW_ROOT}/first-use-routine.yaml" \
  "${FLOW_ROOT}/attention-correction.yaml"
