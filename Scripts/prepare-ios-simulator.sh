#!/bin/bash

set -euo pipefail

readonly EXPECTED_ARGUMENT_COUNT=2
readonly EXIT_USAGE=64
readonly EXIT_UNAVAILABLE=69

if [[ $# -ne $EXPECTED_ARGUMENT_COUNT ]]; then
  printf 'Usage: %s <simulator-name> <device-type-identifier>\n' "$0" >&2
  exit "$EXIT_USAGE"
fi

readonly SIMULATOR_NAME="$1"
readonly DEVICE_TYPE_IDENTIFIER="$2"
readonly RUNTIME_IDENTIFIER="$(
  xcrun simctl list runtimes available -j | jq -r '
    [.runtimes[] | select(.platform == "iOS" and .isAvailable)]
    | sort_by(.version | split(".") | map(tonumber))
    | last
    | .identifier // empty
  '
)"

if [[ -z "$RUNTIME_IDENTIFIER" ]]; then
  printf 'No available iOS simulator runtime was found.\n' >&2
  exit "$EXIT_UNAVAILABLE"
fi

simulator_id="$(
  xcrun simctl list devices available -j | jq -r \
    --arg runtime "$RUNTIME_IDENTIFIER" \
    --arg name "$SIMULATOR_NAME" \
    '.devices[$runtime][]? | select(.name == $name) | .udid' | head -n 1
)"

if [[ -z "$simulator_id" ]]; then
  simulator_id="$(
    xcrun simctl create \
      "$SIMULATOR_NAME" \
      "$DEVICE_TYPE_IDENTIFIER" \
      "$RUNTIME_IDENTIFIER"
  )"
fi

readonly SIMULATOR_ID="$simulator_id"
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
