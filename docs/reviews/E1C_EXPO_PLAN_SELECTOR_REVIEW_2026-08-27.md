# E1C Expo Plan Selector Review

Status: locally verified and independently reviewed; CI pending.

## Scope

- Ported the pure, catalog-independent plan selector to strict TypeScript.
- Added stable selector vocabulary, decision-ID validation, typed continuation states, and immutable outputs.
- Kept persistence, catalog composition, navigation, and UI outside this slice.

## Decisions

- Any persisted or newly triggered Attention blocks all plans.
- Included areas reduce to the gentler recommendation; only a gentler override is accepted.
- A secondary area can be skipped only without bypassing a pending safety answer.
- Missing answers, malformed requests, omissions, explanations, and Pause Today eligibility remain explicit.

## Verification

- A shared fixture verifies the complete stable selected and no-plan interfaces in Swift and Expo.
- Expo typecheck, lint, and 68 tests pass, including exhaustive area, safety, level, and override matrices.
- The full 124-test Swift reference suite passes.
- Project boundaries, Expo dependency compatibility, and the iOS export pass.
- Independent spec and standards reviews report no blocking or important findings.
