#!/bin/bash

set -euo pipefail

readonly REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly EXPECTED_GRDB_IDENTITY="grdb.swift"
readonly EXPECTED_GRDB_VERSION="7.10.0"
readonly EXPECTED_GRDB_REVISION="36e30a6f1ef10e4194f6af0cff90888526f0c115"
readonly EXPECTED_PACKAGE_DECLARATION_COUNT="1"
readonly RELEASE_CONTENT_GATE_MARKER="KINEO-PRODUCTION-CONTENT-REQUIRED"
readonly APPROVED_EXPO_RUNTIME_DEPENDENCIES="@noble/hashes expo expo-constants expo-crypto expo-linking expo-notifications expo-router expo-splash-screen expo-sqlite expo-status-bar expo-video react react-native react-native-safe-area-context react-native-screens"

fail() {
    printf 'Project boundary check failed: %s\n' "$1" >&2
    exit 1
}

require_text() {
    local file_path="$1"
    local expected_text="$2"
    grep -Fq "$expected_text" "$REPOSITORY_ROOT/$file_path" || \
        fail "$file_path must contain: $expected_text"
}

verify_resolved_pin() {
    local file_path="$1"
    local absolute_path="$REPOSITORY_ROOT/$file_path"
    local identity
    local version
    local revision

    identity="$(/usr/bin/plutil -extract pins.0.identity raw "$absolute_path")"
    version="$(/usr/bin/plutil -extract pins.0.state.version raw "$absolute_path")"
    revision="$(/usr/bin/plutil -extract pins.0.state.revision raw "$absolute_path")"

    [[ "$identity" == "$EXPECTED_GRDB_IDENTITY" ]] || fail "$file_path has an unexpected dependency"
    [[ "$version" == "$EXPECTED_GRDB_VERSION" ]] || fail "$file_path has an unexpected GRDB version"
    [[ "$revision" == "$EXPECTED_GRDB_REVISION" ]] || fail "$file_path has an unexpected GRDB revision"
    if /usr/bin/plutil -extract pins.1.identity raw "$absolute_path" >/dev/null 2>&1; then
        fail "$file_path contains an unapproved additional dependency"
    fi
}

cd "$REPOSITORY_ROOT"

require_text "Packages/KineoModules/Package.swift" "exact: \"$EXPECTED_GRDB_VERSION\""
package_declaration_count="$(grep -c '\.package(' Packages/KineoModules/Package.swift || true)"
[[ "$package_declaration_count" == "$EXPECTED_PACKAGE_DECLARATION_COUNT" ]] || \
    fail "Package.swift must declare only the approved GRDB dependency"
verify_resolved_pin "Packages/KineoModules/Package.resolved"
verify_resolved_pin "Kineo.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"

actual_expo_dependencies="$(node -e "const dependencies = Object.keys(require('./apps/mobile/package.json').dependencies).sort(); process.stdout.write(dependencies.join(' '))")"
[[ "$actual_expo_dependencies" == "$APPROVED_EXPO_RUNTIME_DEPENDENCIES" ]] || \
    fail "apps/mobile/package.json contains an unreviewed runtime dependency"

require_text "Configurations/Base.xcconfig" "KINEO_HEALTHKIT_ENABLED = NO"
require_text "Configurations/Base.xcconfig" "KINEO_TELEMETRY_ENABLED = NO"
require_text "Configurations/Base.xcconfig" "KINEO_NETWORK_CLIENT_ENABLED = NO"
require_text "Configurations/Base.xcconfig" "LD_RUNPATH_SEARCH_PATHS = \$(inherited) @executable_path/Frameworks"
require_text "Configurations/ReleaseCandidate.xcconfig" "KINEO_PLACEHOLDER_CONTENT_ALLOWED = NO"
require_text "Configurations/Release.xcconfig" "KINEO_PLACEHOLDER_CONTENT_ALLOWED = NO"
require_text "App/KineoApp.swift" "$RELEASE_CONTENT_GATE_MARKER"

if git grep -n -E \
    'CODE_SIGN_ENTITLEMENTS|SystemCapabilities|com\.apple\.developer\.healthkit|HealthKit\.framework|Network\.framework' \
    -- Kineo.xcodeproj Configurations; then
    fail "an entitlement, capability, or prohibited framework was introduced"
fi

if git grep -n -I -E \
    '(^|[[:space:]])(fetch|XMLHttpRequest|WebSocket)[[:space:](]|from[[:space:]].*(axios|@apollo|firebase|@sentry)|https?://' \
    -- 'apps/mobile/src/**/*.ts' 'apps/mobile/src/**/*.tsx' \
       'apps/mobile/modules/**/*.ts' 'apps/mobile/modules/**/*.tsx'; then
    fail "production Expo sources contain a network client or endpoint"
fi

if git grep -n -I -E \
    'HealthKit|com\.apple\.developer\.|UIBackgroundModes|associatedDomains' \
    -- apps/mobile/app.json apps/mobile/modules; then
    fail "Expo configuration or native modules contain an unapproved capability"
fi

if git grep -n -E \
    '(^|[[:space:]])import[[:space:]]+(HealthKit|Network|CloudKit)([[:space:]]|$)|URLSession|NW(Connection|Path|Browser)|https?://' \
    -- 'App/*.swift' 'Packages/KineoModules/Sources/**/*.swift' \
       'apps/mobile/modules/**/*.swift'; then
    fail "production Swift sources contain a network or cloud API"
fi

if git grep -n -I -E \
    'AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{36,}|sk_(live|test)_[A-Za-z0-9]{16,}' \
    -- . ':(exclude)Scripts/verify-project-boundaries.sh'; then
    fail "a tracked file matches a high-confidence secret pattern"
fi

if git ls-files | grep -Eq '(^|/)(\.DS_Store|DerivedData|xcuserdata|\.expo|dist)(/|$)|apps/mobile/(ios|android)(/|$)|\.xcuserstate$'; then
    fail "generated or user-specific files are tracked"
fi

if [[ -n "$(git ls-files '*PrivacyInfo.xcprivacy')" ]]; then
    fail "a privacy manifest changed without an approved baseline update"
fi

printf 'Project boundaries verified: dependencies, flags, capabilities, privacy surface, secrets, and repository hygiene.\n'
