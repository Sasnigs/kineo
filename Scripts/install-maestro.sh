#!/bin/bash

set -euo pipefail

readonly MAESTRO_VERSION="2.10.0"
readonly MAESTRO_SHA256="29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991"
readonly MAESTRO_RELEASE_URL="https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip"
readonly EXPECTED_ARGUMENT_COUNT=1

if [[ $# -ne $EXPECTED_ARGUMENT_COUNT ]]; then
  printf 'Usage: %s <install-root>\n' "$0" >&2
  exit 64
fi

readonly INSTALL_ROOT="$1"
readonly VERSIONED_INSTALL_ROOT="${INSTALL_ROOT}/maestro-${MAESTRO_VERSION}"
readonly MAESTRO_BIN="${VERSIONED_INSTALL_ROOT}/bin/maestro"

if [[ -x "$MAESTRO_BIN" ]]; then
  printf '%s\n' "$MAESTRO_BIN"
  exit 0
fi

readonly DOWNLOAD_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/kineo-maestro.XXXXXX")"
readonly ARCHIVE_PATH="${DOWNLOAD_DIRECTORY}/maestro.zip"
readonly EXPANDED_PATH="${DOWNLOAD_DIRECTORY}/expanded"

curl --fail --location --silent --show-error "$MAESTRO_RELEASE_URL" --output "$ARCHIVE_PATH"
printf '%s  %s\n' "$MAESTRO_SHA256" "$ARCHIVE_PATH" | shasum -a 256 --check >&2
mkdir -p "$EXPANDED_PATH" "$INSTALL_ROOT"
unzip -q "$ARCHIVE_PATH" -d "$EXPANDED_PATH"
mv "${EXPANDED_PATH}/maestro" "$VERSIONED_INSTALL_ROOT"

if [[ ! -x "$MAESTRO_BIN" ]]; then
  printf 'Maestro installation did not produce %s.\n' "$MAESTRO_BIN" >&2
  exit 1
fi

printf '%s\n' "$MAESTRO_BIN"
