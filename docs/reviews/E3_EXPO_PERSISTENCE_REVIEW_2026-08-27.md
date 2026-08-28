# E3 Expo Persistence Review

Status: locally verified; CI pending.

## Scope

- Ported the normalized SQLite schema, migrations, profile, check-ins, Attention, decisions, Pause Today, routine checkpoints, feedback, Reset History, and full deletion.
- Added an Expo iOS module for Application Support storage, Complete Protection, backup exclusion, and deletion recovery.

## Review decisions

- Writes use exclusive transactions and exact-retry checks; injected child-write failures roll back the entire operation.
- Corrupt decision data, routine audit history, or snapshot bytes fail closed.
- Every successful write re-verifies database, WAL, and SHM protection. Failure poisons the store instance.
- Delete All Data writes a protected marker before closing SQLite; launch completes any interrupted deletion before reopening storage.

## Verification

- Expo: 20 suites and 138 tests pass; typecheck, lint, dependency versions, and project boundaries pass.
- Native Expo storage target compiles for the iOS Simulator.
- Swift reference: 125 tests pass.
- Security audit has no high or critical advisory; 11 moderate transitive Expo CLI advisories remain without a non-breaking upstream fix.

Physical-device lock and backup inspection remain E5/E6 release gates.
