# Production Phase 4 — Remaining v1.1 product screens

Date: 2026-11-05  
Branch: `frontend-redesign`  
Base HEAD: `2960cc0`  
Status: UI implementation and local functional checks complete; the npm audit gate remains blocked. No release or native visual sign-off is claimed.

## Delivered

- Migrated Progress, Area History (including its unavailable fallback), Profile, area preferences, reset/export/password/delete/logout confirmations, and product-level welcome/loading/error screens to the existing v1.1 shell and primitives.
- Progress now uses the focal participation card with tabular numerals and semantic progress copy, anatomical area/session rows, an empty state, and the existing participation qualification. Area History retains its metrics, dated entries, Active availability statement, and explicit non-causation footnote.
- Profile uses shared animated menu rows, quiet section headings, semantic danger treatment, and v1.1 reminder notices. Main-tab routes retain Today/Progress/Profile labels and selected-state semantics.
- Area preferences use separate labeled primary/secondary radio groups and exact area names. Group wrappers do not swallow individual native radio focus; each radio also exposes its group as an accessibility hint. Draft selection stays local until Save areas, including retaining a deliberately cleared second area when changing the primary area.
- Confirmation screens retain all existing account/service commands, cancellation paths, protected-history wording, and password requirements. Password fields now have persistent visible labels, matching accessible names, secure entry, 52px minimum height, 14px radius, and strong borders. Password mismatch uses an alert notice. The shared scroll view enables automatic native keyboard insets.
- Removed the superseded Shell, PageHeader, BrandMark, HeroArtwork, InfoPill, PrimaryButton, SecondaryButton, ChoiceButton, NavigationBar, the unused choice-icon mapper, and 59 unused style rules from the product file.
- Preserved Phase 2 and 3 working-tree changes, including the authorized read-only plan projection, routine clock/domain behavior, media lifecycle, completion choreography, Maestro adjustments, and boundary allowlist. Phase 4 did not modify core, application, infrastructure, tokens, or `apps/mobile/ios`.

## Files changed by Phase 4

Paths are repository-relative; several already contained uncommitted Phase 2/3 work, which remains intact.

- `apps/mobile/src/ui/product/kineo-product-app.tsx`
- `apps/mobile/src/ui/product/kineo-product-app.test.tsx`
- `apps/mobile/src/ui/primitives/kineo-v11-primitives.tsx`
- `apps/mobile/src/ui/primitives/kineo-v11-primitives.test.tsx`
- `apps/mobile/src/ui/primitives/kineo-v11-shell.tsx`
- `apps/mobile/package.json`
- `apps/mobile/package-lock.json`
- `docs/reviews/PRODUCTION_PHASE_4_2026-11-05.md`

The manifest/lock change made in this phase is a `zod: 4.6.7` override. Both consuming development tools declare support for Zod 4; the pre-existing React DOM, braces, and node-forge security overrides are unchanged. This resolves one pre-existing high-severity audit finding. The earlier Phase 2 runtime dependency additions are retained.

## Verification

Commands used the repository-pinned Node 24.20.0 / npm 11.19.0 toolchain. Temporary npm/Expo caches were isolated under `/tmp`.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Exit 0; no TypeScript errors | `/tmp/kineo-phase4-mobile.log` |
| `npm run lint` | Exit 0; no ESLint warnings/errors | `/tmp/kineo-phase4-mobile.log` |
| Full serial Jest run | 53/53 suites, 442/442 tests pass | `/tmp/kineo-phase4-mobile.log` |
| `Scripts/verify-project-boundaries.sh` | Exit 0 | `/tmp/kineo-phase4-boundaries.log` |
| `node Scripts/agent-check.mjs tooling` | Exit 0; docs/contracts and 23 harness tests pass | `/tmp/kineo-phase4-tooling.log` |
| `node Scripts/agent-check.mjs mobile` | Exit 0; runs typecheck, lint, and `test:ci` (`jest --runInBand`) | `/tmp/kineo-phase4-mobile.log` |
| `npm run dependencies:check` | Exit 0; online Expo check reports dependencies up to date | `/tmp/kineo-phase4-dependencies.log` |
| `npm run security:check` | Exit 0; 10/10 dependency security regression tests | `/tmp/kineo-phase4-security.log` |
| `npm run audit` | **Exit 1**; 23 findings: 3 high, 11 moderate, 9 low | `/tmp/kineo-phase4-audit.log` |
| `EXPO_NO_DOTENV=1 npx expo export --platform ios --output-dir /tmp/kineo-phase4-ios-export` | Exit 0; Hermes bundle exported | `/tmp/kineo-phase4-export.log` |
| `git diff --check` | Exit 0 | Local working-tree check |

The full Jest invocation above uses the CI alias `npm run test:ci`, which executes the same `jest --runInBand` command as `npm test -- --runInBand`. Focused product/primitives tests were also run. Seven new tests cover the Phase 4 flows and adaptive menu behavior. An initial radio-group test failed because React Native grouping containers are intentionally not single accessible elements; the implementation and test now preserve individually focusable radios and verify group hints/selection rather than hiding controls behind one group focus target.

## Independent code review

A read-only reviewer compared the Phase 4 delta with the preserved Phase 3 source snapshot. Two findings were repaired and re-reviewed:

1. The migrated welcome footer initially lost horizontal padding. Get started now uses the existing `v11ActionInset` readable-width wrapper.
2. Primary/secondary area radios initially lacked separate group context. They now have distinct labeled groups and individual group hints while retaining exact radio names.

The follow-up review found no remaining material defects in the inspected UI delta. This was source review, not simulator, VoiceOver, or still-image review.

## Remaining audit blocker

The high-severity chain is `decode-uri-component@0.2.2` → `query-string@7.1.3` → `expo-router@57.0.30` (one vulnerable dependency chain reported at three package nodes). npm proposes `expo-router@58.0.30` through a forced breaking update. The installed query-string consumer calls the decoder as a CommonJS function; decoder 0.5.1 publishes an ESM default export. A bare override would change that interface and is not an acceptable security repair without a compatible integration.

The decoder's [upstream advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) identifies 0.5.1 as the fix. The separate [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) identifies 4.6.6 as patched; this phase uses 4.6.7. The audit dropped from 24 findings / 4 high to 23 findings / 3 high after that compatible update.

No `npm audit fix --force`, SDK migration, audit suppression, or severity-threshold change was applied. A separately scoped compatible Router/decoder repair or Expo upgrade remains necessary before the full requested CI gate can be called green. Passing the dedicated braces/forge regression tests does not waive the failed audit.

## Practical limits and handoff

- No simulator screenshots, Maestro journeys, physical-device motion checks, or VoiceOver verification were performed in this phase. Dark appearance, large Dynamic Type, keyboard inset behavior, and native press/motion feel still require native validation; Jest coverage is not a substitute.
- The iOS export proves JavaScript bundling without dotenv; it is not an Xcode native build or simulator run. The generated iOS project was not edited.
- No commits, staging, pushes, or remote GitHub Actions run were made. The working tree contains the preserved Phase 2/3 work plus this Phase 4 delta.
