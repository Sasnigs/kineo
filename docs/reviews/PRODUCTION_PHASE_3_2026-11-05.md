# Production Phase 3 — evidence

Date: November 5, 2026. Branch: `frontend-redesign`; HEAD `2960cc0`. Existing uncommitted Phase 2 work was preserved. Phase 3 remains unstaged/uncommitted for owner review.

## Delivered

- Added `kineo-v11-routine.tsx`: architectural exercise-video frame with a 30-point minimum provenance lane (13/18 type, 16-point horizontal inset), transition card, SVG countdown instrument with native tabular numerals, quiet completion/ready pill, and measured completion choreography. The footer can grow with Dynamic Type; large text uses an uncluttered native countdown rather than squeezing numerals inside the ring.
- The countdown is derived from the existing authoritative `stepElapsedMilliseconds` refresh. It displays the same active duration used by the existing Continue gate. There is no new timer truth, domain clock, auto-advance, or persistence command.
- Live completion runs the explicit 280ms hold/pulse, 520ms measured dial fold, and staggered upward status/caption/control rise. Animations cancel on unmount, stage changes, and Reduce Motion changes. Reduced motion and already-completed/transition mounts render the settled state immediately. Completion is announced once through the native accessibility API; per-second values do not announce automatically.
- Status pills use a 1px boundary, semibold label, no shadow/elevation, and a decorative 14-point check only for completed movement states. Transitions use Next step ready without a check or competing dial.
- Upgraded active/prepared/paused routine, alternative preview, end confirmation, safety guidance, feedback, and Routine Saved presentation to shared v1.1 components. Continue and Something feels wrong stay reachable in the shell footer and move into scroll flow at large text sizes.
- Running movements retain Alternative (accessible name Try an alternative), Skip this step, and Pause. Completed/transition stages retain an ordinary End routine path without the redundant running transport strip. Existing commands and confirmation/recovery behavior remain intact.
- Video respects OS Reduce Motion and pauses on background while mounted. `useVideoPlayer` retains ownership of native release; passive cleanup does not call an already released player.
- Routine Saved uses the forest-green confirmation emblem and level/duration/area summary. Requested participation wording is limited to completed/stopped statuses that Progress counts; safety-stopped records truthfully say Routine record: Saved.
- Updated the sorted runtime dependency allowlist with MaskedView, expo-blur, expo-build-properties, and react-native-svg. No new runtime dependency was added in Phase 3.
- The existing Maestro Alternative action now uses its existing scroll-safe tap helper with the same accessible label and navigation sequence.

## Phase 3 files

Paths are relative to `/Users/chiemerieonyeanusi/Documents/Codex/Kineo-working/kineo`.

- `apps/mobile/src/ui/primitives/kineo-v11-routine.tsx` — new
- `apps/mobile/src/ui/primitives/kineo-v11-primitives.tsx` — destructive action primitive
- `apps/mobile/src/ui/primitives/kineo-v11-primitives.test.tsx`
- `apps/mobile/src/ui/product/kineo-product-app.tsx`
- `apps/mobile/src/ui/product/kineo-product-app.test.tsx`
- `apps/mobile/src/ui/theme/tokens.ts`
- `apps/mobile/.maestro/interruption-and-safety.yaml`
- `Scripts/verify-project-boundaries.sh`
- `docs/reviews/PRODUCTION_PHASE_3_2026-11-05.md` — new

No Phase 3 edits were made to `apps/mobile/ios`, core, application, infrastructure, the signed-off HTML/CSS canvas, or Phase 1 account screens. The existing core/application projection changes in the working tree are the separately authorized Phase 2 changes.

## Verification

Node 24.20.0 / npm 11.19.0.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Exit 0; zero errors |
| `npm run lint` | Exit 0; zero warnings/errors |
| `npm test -- --runInBand` | Exit 0; **53 suites / 435 tests passed** |
| Focused product/primitives tests | 2 suites / 33 tests passed |
| `Scripts/verify-project-boundaries.sh` from repository root | Exit 0; Project boundaries verified |
| `npm run dependencies:check` (online) | Exit 0; dependencies up to date |
| `npm run security:check` | Exit 0; all 10 regression checks passed |
| `EXPO_NO_DOTENV=1 npx expo export --platform ios --output-dir /tmp/kineo-phase3-ios-export` | Exit 0; iOS Hermes bundle/assets generated |
| Maestro YAML parsing | All 7 files parse; selector/action contracts retained |
| Independent code review | Three actionable findings fixed; follow-up found no additional actionable issue |
| `git diff --check` | Exit 0 |
| Generated iOS diff | Empty |

New coverage verifies timer formatting/progress semantics, no Your pace subheading, quiet non-interactive badges, reduced-motion completion, once-only hold/fold/rise scheduling and completion announcement, transition presentation, authoritative Continue locking/unlocking, saved summary copy, safety-stop truthfulness, and video release cleanup.

## Native verification still pending

No native screenshots, Maestro execution, VoiceOver behavior, real video playback, or release-device animation performance are claimed. The iOS bundle verifies compilation, not native rendering or motion feel. `apps/mobile/ios` was deliberately not regenerated or modified. Phase 4's native verification must inspect narrow/dark/large-text/RTL layouts, pinned safety reachability, video framing and background behavior, the three completion beats and interruption, and accessibility announcements. CI was not remotely run and no push/PR/merge is claimed. Product, provider, content/media, legal, physical-device, and public-release gates remain separate.
