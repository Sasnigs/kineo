#!/bin/bash

set -euo pipefail

readonly EXPECTED_ARGUMENT_COUNT=0
readonly EXIT_USAGE=64
readonly EXIT_UNAVAILABLE=69

if [[ $# -ne $EXPECTED_ARGUMENT_COUNT ]]; then
  printf 'Usage: %s\n' "$0" >&2
  exit "$EXIT_USAGE"
fi

readonly SIMULATOR_ID="$(
  xcrun simctl list devices available -j | jq -r '
    [.devices[][]
      | select(.deviceTypeIdentifier | startswith("com.apple.CoreSimulator.SimDeviceType.iPhone"))]
    | first
    | .udid // empty
  '
)"

if [[ -z "$SIMULATOR_ID" ]]; then
  printf 'No preinstalled iPhone simulator was found.\n' >&2
  exit "$EXIT_UNAVAILABLE"
fi

readonly SIMULATOR_STATE="$(
  xcrun simctl list devices -j | jq -r \
    --arg simulator_id "$SIMULATOR_ID" \
    '.devices[][] | select(.udid == $simulator_id) | .state'
)"

if [[ "$SIMULATOR_STATE" != "Booted" ]]; then
  xcrun simctl boot "$SIMULATOR_ID"
fi
xcrun simctl bootstatus "$SIMULATOR_ID" -b >&2
printf '%s\n' "$SIMULATOR_ID"
