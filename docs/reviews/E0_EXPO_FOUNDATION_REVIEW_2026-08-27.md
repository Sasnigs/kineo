# E0 Expo Foundation Review

Status: locally verified; CI pending.

## Decision

- Expo SDK 57, React Native 0.86, React 19.2, and Node 24.20 are pinned.
- Swift remains the runnable reference until each product slice reaches parity.
- Expo Core cannot import React, React Native, Expo, or native infrastructure.

## Verification

- TypeScript strict check: pass.
- ESLint and Core dependency boundary: pass.
- Frozen area-level decision matrix: 9/9 pass.
- Expo dependency compatibility: pass.
- iOS bundle export: pass.
- Xcode Release simulator build and launch: pass on iPhone 17 Pro.
- Swift suite: 121 tests pass; project-boundary verification passes.
- Swift verification remains required in CI.

## Dependency review

- Direct packages are SDK-compatible and use MIT licenses, except TypeScript (Apache-2.0).
- Audit gate: 0 high and 0 critical findings.
- The 11 reported moderate paths reduce to `uuid` through Expo's Xcode project tooling. The affected APIs are UUID v3/v5/v6 with a caller buffer; the installed `xcode` package uses UUID v4.
- npm's forced fix would downgrade compatible SDK 57 packages and is rejected.
- `fsevents` install scripts are denied. `unrs-resolver@1.12.2` is approved only at the reviewed, pinned version; its required native binary is already packaged.

Reassess the `uuid` advisory on every Expo SDK update and before production release.
