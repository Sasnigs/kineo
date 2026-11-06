# Production Phase 2 — evidence

Date: November 5, 2026. Branch: `frontend-redesign`. Base: `2960cc0` (Phase 1). Phase 2 changes remain unstaged/uncommitted for owner review.

Implemented the v1.1 presentation for product onboarding, Today, Attention return/guidance, the two-step check-in plus conditional safety question, and Plan. Existing actions, tested copy, radio/button names, and service command boundaries are preserved. Routine/player/video and Profile internals remain for subsequent phases; their shared tab dock now uses the v1.1 primitive.

## Changes

- Added anatomical `V11AreaEmblem` (including combined-region support), accessible `V11ProgressPill`, and controlled `V11SegmentedControl`.
- Extended `V11ChoiceRow` with a decorative leading emblem and explicit accessible-name override. Area names remain exactly Neck / Upper & mid back / Lower back; immediate check-in choices retain the existing button role.
- Added `V11Shell`: safe-area scroll layout, measured overflow affordance, pinned regular-size actions, and all footer content in scroll flow above the large-text threshold. Its 32-point fade uses six static masked blur layers only while more content remains below; scrolling updates shared values, not React state per frame. Reduce Transparency disables the translucent overlay; the native scroll indicator remains available.
- Duration selection uses measured option frames and `v11Motion.pillSpring`; it stacks at large text and snaps when reduced motion is enabled. Explicit logical anchors preserve physical-left measurement coordinates in RTL. Corrected the shared tab lens anchor by the same rule.
- Plan uses one restrained focal summary, authored explanation/omission copy, the sliding duration selector, a collapsible real sequence, gentler/Pause Today actions, Begin routine, and the floating tab dock. Selection remains tied to the committed plan; Begin and duration controls disable during a pending revision.
- Onboarding, safety, Today, and check-in use the shared v1.1 headers, notices, emblems, choices, and actions. Today displays the actual primary area supplied by its existing start-state projection; it does not invent a secondary area.
- **Owner-authorized scope clarification:** added the narrow read-only `PlanSequenceStep` projection in `src/core/product/product-flow.ts` and populated it from the already-composed authored sequence in `src/application/kineo-product-service.ts`. No selection algorithm, persistence contract/write, session-start behavior, or infrastructure module was changed. Older adapters without the optional projection receive an honest count summary rather than invented movement rows.
- Added SDK-compatible `expo-blur` ~57.0.3 and promoted the existing compatible MaskedView 0.3.2 dependency to a direct dependency. No generated iOS files were touched.

## Files created or modified

Paths are relative to `/Users/chiemerieonyeanusi/Documents/Codex/Kineo-working/kineo`.

- `apps/mobile/src/ui/primitives/kineo-v11-primitives.tsx`
- `apps/mobile/src/ui/primitives/kineo-v11-shell.tsx` — new
- `apps/mobile/src/ui/primitives/kineo-v11-primitives.test.tsx`
- `apps/mobile/src/ui/product/kineo-product-app.tsx`
- `apps/mobile/src/ui/product/kineo-product-app.test.tsx`
- `apps/mobile/src/ui/theme/tokens.ts`
- `apps/mobile/src/core/product/product-flow.ts` — authorized read-only type extension
- `apps/mobile/src/application/kineo-product-service.ts` — authorized read-only projection
- `apps/mobile/src/application/kineo-product-service.test.ts`
- `apps/mobile/package.json`
- `apps/mobile/package-lock.json`
- `docs/reviews/PRODUCTION_PHASE_2_2026-11-05.md` — new

## Verification

Toolchain: Node 24.20.0 / npm 11.19.0.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Exit 0; zero TypeScript errors |
| `npm run lint` | Exit 0; zero lint warnings/errors |
| `npm test -- --runInBand` | Exit 0; **53 suites / 426 tests passed** |
| Targeted product/primitives/application tests | 3 suites / 54 tests passed |
| `npm run dependencies:check` (online) | Exit 0; dependencies up to date |
| `npm run security:check` | Exit 0; all 10 regression checks passed |
| `EXPO_NO_DOTENV=1 npx expo export --platform ios --output-dir /tmp/kineo-phase2-ios-export` | Exit 0; iOS Hermes bundle/assets generated |
| `git diff --check` | Exit 0 |
| Independent read-only review | RTL lens finding fixed; follow-up found no actionable remaining code issue |
| `apps/mobile/ios` and infrastructure diff | Empty |

New coverage verifies exact area radio names with descriptors, combined emblem labeling, progress context, controlled/disabled duration selection, RTL lens anchors, large-text footer reachability, no stale-plan start during revision, and sequence order/timing consistency with restored plans and the first routine item. Inspecting the read-only sequence does not start a session.

## Native checks still pending

No native simulator/device rendering, screenshots, VoiceOver, keyboard traversal, release-device motion, or progressive-blur compositing/performance is claimed. The Phase 1 simulator-service restriction remains an external verification limitation; this pass did not modify or regenerate `apps/mobile/ios`. A normal native rebuild/autolinking step is required for the blur dependency when native integration resumes.

Verify the complete flow at narrow widths, dark mode, maximum Dynamic Type, RTL, Reduce Motion, and Reduce Transparency on a working native target. First-fold movement clearance and natural partial-row fade positioning require that rendered inspection; source and Jest checks are not visual sign-off. Public-release, provider, content, legal, physical-device, and security gates remain separate. Phase 3 can build on this implementation without changing its command/data boundaries.
