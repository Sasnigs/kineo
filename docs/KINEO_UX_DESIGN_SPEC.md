# Kineo v1 UX Design Specification

Status: approved UX contract for prototype implementation

Platform: Expo/React Native iPhone app with native iOS interaction semantics

Reference viewport: iPhone 16 Pro, 402 × 874 pt

Product source: `KINEO_PRODUCT_DESIGN.md`

## 1. Product experience

Kineo is a daily movement-decision companion for adults experiencing recurring discomfort in the neck, upper or mid-back, or lower back. It is not an exercise library, diagnosis tool, treatment, clinical measurement system, or pain-recovery promise.

The primary experience is:

1. The user reports how each selected area feels and how comfortable movement feels.
2. Kineo checks whether a worse or limited report is new or unusual for that specific area.
3. An eligible session receives a short plan at a Gentle, Balanced, or Active level with a plain-language reason. Any unresolved Attention Required record withholds all new Kineo routines, including after area preferences change.
4. The user follows reviewed movement content, with alternatives, skipping, pausing, and an always-visible safety path.
5. The user may report Better, Same, or Worse afterward.
6. Later plans may use the user’s own prior Kineo check-ins and responses.

The daily decision and its explanation must be visually more prominent than movement content. There is no browseable exercise library in primary navigation.

## 2. Navigation and information architecture

Primary tabs:

- Today: check-in, plan decision, and session entry.
- Progress: the user’s reports, routine history, and neutral consistency summary.
- Profile: areas, preferences, reminders, data choices, safety information, and support.

Onboarding is progressive. Only age eligibility, primary area, optional secondary area, and the product boundary are requested before the first check-in. Optional integrations and analytics are introduced later, when their purpose is clear.

## 3. Visual direction

Kineo should feel calm, intelligent, warm, and task-first. It should not resemble a fitness marketplace, anatomy scanner, gamified streak app, or clinical dashboard.

### Color

- Core accent: deep eucalyptus green `#2B665B`.
- Pressed accent: `#1F4F47`.
- Soft accent surface: `#E9F4F0`.
- Warm fallback canvas: `#F8F7F2`.
- Attention surface: `#FFF3DD`.
- Attention text: `#7A4711`.
- Destructive red is reserved for deletion and genuinely destructive actions.
- Native backgrounds, labels, fills, and separators use Apple semantic variables so appearance adapts with iOS.

Color is never the only state cue. Selected states include a border and checkmark. Plan levels include a written name and symbol or shape. Charts include labels and values.

### Typography

Use SF Pro and native Dynamic Type semantics.

| Role | Figma reference | SwiftUI intent |
|---|---:|---|
| Large title | 34/41 Bold | `.largeTitle.bold()` |
| Title 1 | 28/34 Bold | `.title.bold()` |
| Title 2 | 22/28 Semibold | `.title2.weight(.semibold)` |
| Headline | 17/22 Semibold | `.headline` |
| Body | 17/24 Regular | `.body` |
| Callout | 16/21 Regular | `.callout` |
| Subheadline | 15/20 Regular | `.subheadline` |
| Footnote | 13/18 Regular | `.footnote` |
| Caption | 12/16 Medium | `.caption.weight(.medium)` |

Layouts must support accessibility text sizes through vertical scrolling and reflow. Do not scale text down to preserve a fixed composition.

### Geometry

- Screen margin: 20 pt.
- Minimum touch target: 44 × 44 pt.
- Standard control height: 52 pt.
- Compact gap: 8 pt.
- Standard gap: 12 or 16 pt.
- Section gap: 24 or 32 pt.
- Control radius: 16 pt.
- Card radius: 24 pt.
- Full radius is reserved for pills, toggles, and circular controls.

The decorative signature is a restrained curved movement-path line. Do not use medical body diagrams or simulated scanning imagery.

## 4. Reusable component contract

### `K/Button`

- Styles: Primary, Secondary, Quiet, Destructive.
- States: Default, Pressed, Disabled.
- Text property and optional leading SF Symbol.
- Minimum height 52 pt; may grow vertically for Dynamic Type.
- Destructive styling is not used for safety guidance or pausing.

### `K/Choice Card`

- States: Default, Selected, Disabled.
- Properties: title, optional subtitle, optional SF Symbol.
- Selection uses soft fill, accent border, and checkmark.
- Used for area, check-in, comfort, and post-routine responses.

### `K/Plan Card`

- Levels: Gentle, Balanced, Active.
- Displays reason, included areas, content count, duration choice, and start action.
- The reason only references allowed Kineo inputs. Health app data never appears as a selection reason.

### `K/Level Pill`

- Levels: Gentle, Balanced, Active.
- Always includes written text and a distinguishing symbol or shape.

### `K/Notice Card`

- Kinds: Information, Attention, Offline.
- Properties: title, body, optional action.
- Attention is amber and calm, not alarming.

### `K/Routine Step`

- Media region, movement title, written instruction, safety cue, timer or repetition count, and step progress.
- Instructions remain usable without video, audio, or animation.
- Production movement content must be reviewed; prototypes are explicitly labeled.
- Builds used with anyone outside the product team include professionally reviewed interim safety and Attention guidance. Without it, participants receive only isolated, non-functional mockups that cannot accept check-ins, enter safety branches, or start routines.

### `K/Response Choice`

- Values: Better, Same, Worse.
- Each uses text plus a directional symbol.
- Presentation stays neutral and does not reward a particular response.

### Native dependencies

- Apple status bar, tab bar, navigation patterns, sheets, segmented controls, and SF Symbols.
- Product bezel is optional for presentations and never part of the app viewport.

## 5. Screen inventory

### `00 Cover`

- Product name, working line, design version, principles, and links to major flows.

### `01 Foundations`

- Color roles, type ramp, spacing and radius scale, effects, accessibility notes, Apple-library dependencies.

### `02 Components`

- Every local component and variant, property notes, usage guidance, and native dependencies.

### `10 Onboarding`

- `O1 Welcome`: “Movement for how today feels”; Get started; adults-only and non-treatment boundary.
- `O2 Age confirmation`: asks only whether the user is 18 or older. Under 18 shows an unavailable state.
- `O3 Primary area`: Neck; Upper or mid-back; Lower back. Accessible list cards, no body map.
- `O4 Secondary area`: None or one remaining area; explains that it adds a short module.
- `O5 Safety boundary`: concise limits and acknowledgement for usual recurring discomfort.
- `O6 First check-in handoff`: selected-area summary and “Check in for today.”

### `20 Today and check-in`

- `T1 Today — ready`: date, selected areas, check-in entry, small consistency summary.
- `T2 Change`: Better, Similar, Worse for one named area; progress 1 of 2.
- `T3 Movement comfort`: Limited, Okay, Good for the same area; progress 2 of 2.
- `T4 Two-area compact check-in`: two region cards, at most four required taps; the secondary area can be left out before a Worse/Limited answer triggers its conditional question, but not afterward as a safety bypass.
- `T5 Conditional safety question`: shown only after Worse or Limited; asks whether the change is new, sudden, or unusual for the named area.
- `T6 Attention required`: no new Kineo routine while any named area remains flagged; show reviewed next-step guidance and provide mistake correction.
- `T7 Plan — Gentle`: reason, included areas, reviewed content preview, Standard selected as the visible prototype default with Quick available, Start, gentler option when valid, Pause today. Changing duration or level disables Start until the revised plan commits.
- `T8 Plan variants`: Balanced and Active; Active may be locked until the area has two qualifying sessions.
- `T9 Pause Today sheet`: validates pausing as participation and avoids lost-streak language.

### `30 Guided routine`

- `R1 Routine step`: close, step count, visible safety control, media, text instruction, safety cue, timer/repetitions, Alternative, Skip, Pause.
- `R2 Timer active`: remaining time and pause control; no motion-dependent information.
- `R3 Paused`: Resume, End routine, and “Something feels wrong.”
- `R4 Alternative movement`: reviewed alternative and a short reason choice; no generated replacement content.
- `R5 Safety guidance`: immediately pauses media and timing and shows reviewed guidance. End Routine is primary; “I tapped this by mistake” returns only to the ordinary Paused screen, where a separate Resume action is required.
- `R6 Feedback — one area`: Better, Same, Worse, or Skip.
- `R7 Feedback — two areas`: independent compact response rows for each included area.
- `R8 Completion`: duration, level, included areas, and neutral consistency acknowledgment.

### `40 Progress`

- `P1 Overview`: “3 of 4 consistency days,” recent sessions, labeled response bars, Health app context in a separate section.
- `P2 Area detail`: area selector, check-in timeline, level history, response distribution, and explicit non-causation copy.
- `P3 Empty`: patterns appear after the user has Kineo history.

### `50 Profile`

- `S1 Profile`: areas, preferences, reminders, Health app, privacy, safety, support, app information.
- `S2 Areas`: change primary and optional secondary; area histories remain separate.
- `S3 Reminders`: optional reminder window and neutral notification preview.
- `S4 Health app context`: disabled in the initial prototype. If later approved, show observable connection/context states, data types, and a statement that this data does not select routines; never claim that HealthKit revealed a denied read permission.
- `S5 Privacy and data`: local sensitive-data explanation, absence of initial-prototype telemetry, Reset History with explicit retention of any current Attention gate, and Delete All with exact scope.
- `S6 Delete confirmation`: exact Kineo data removed; Apple-held data is separate.
- `S7 Analytics choice`: deferred and absent from the initial prototype. It may appear only after a separate data-flow design is approved; if added, it remains off until opt-in and is limited to approved operational counts.

### `60 Safety and system states`

- `E1 Attention return`: asks whether the named area returned to its usual recurring pattern; Yes, No, Not sure, selected by mistake.
- `E2 Content unavailable`: no approved routine exists; no invented fallback.
- `E3 Secondary omitted`: eligible primary-area routine continues only when reviewed combined content is unavailable or incompatible; the omitted secondary area is disclosed. A safety flag never uses this fallback.
- `E4 Offline`: no persistent warning in the initial prototype because every core action is local. A future remote-only context may show a local notice without degrading the core flow.
- `E5 Age unavailable`: adults-only boundary without collecting a birth date.
- `E6 Health app unavailable`: core flow remains available.
- `E7 Dynamic Type`: representative Today, Check-in, Plan, Routine, and safety states at accessibility sizes.

## 6. Decision and safety behavior

The plan level is deterministic and explainable. The UI must never imply that duration changes the selected level or improves recovery. Quick and Standard change how much reviewed content is included, not the safety decision.

Baseline matrix for an eligible area:

| Change | Comfort | Result |
|---|---|---|
| Worse | Limited | Gentle, after the conditional safety answer is No |
| Worse | Okay/Good | Gentle, after the conditional safety answer is No |
| Similar | Limited | Gentle, after the conditional safety answer is No |
| Similar | Okay | Balanced |
| Similar | Good | Balanced, including when Active is otherwise unlocked |
| Better | Limited | Gentle, after the conditional safety answer is No |
| Better | Okay | Balanced |
| Better | Good | Active only after qualification rules pass; otherwise Balanced |

Safety state is stored independently per area but gates new Kineo routines globally while unresolved:

- `No`: the named area can continue through normal plan selection.
- `Yes` or `Not sure`: the named area enters Attention state and no new Kineo routine is available until it is cleared.
- The user cannot bypass the flag by omitting a secondary or changing area preferences. Kineo has no reviewed basis for assuming that another supported neck/back routine is isolated from it.
- A later session asks whether the named area has returned to its usual pattern.
- “Selected by mistake” starts a fresh correction and returns to the relevant check-in question without clearing Attention. The flag clears only when a complete corrected entry is submitted with no conditional trigger or the required No answer; abandoning correction or answering Yes/Not sure keeps it.

Age eligibility is a product boundary, not a safety classifier. User answers cannot be verified; copy clearly assigns the user responsibility for accurate answers without using blame.

## 7. Prototype connections

- Primary: `O1 → O2 Yes → O3 → O4 → O5 → O6 → T2 → T3 → T7 → R1 → R2 → R6 → R8 → T1`.
- Safety: `T2 Worse or T3 Limited → T5 → T6 → E1`.
- Safety: any area enters Attention → `T5 → T6`; all new routine entry remains blocked until return-to-usual or correction clears every current flag.
- Catalog fallback: both areas pass safety, but combined content is unavailable/incompatible → `E3`; disclosed primary-only plan continues.
- Pause: `T7 → T9 → T1`.
- Routine controls: `R1 → R3`, `R1 → R4`, safety control `R1/R3 → R5`.
- Tabs: `T1 ↔ P1 ↔ S1`.

## 8. Accessibility and content requirements

- Every interactive target is at least 44 × 44 pt.
- Controls expand vertically for Dynamic Type and never truncate action labels.
- Focus and VoiceOver order follows visual reading order; modal sheets trap focus until dismissed.
- Decorative movement paths are hidden from accessibility APIs.
- SF Symbols receive explicit accessibility labels where the adjacent text is insufficient.
- Timer information is available as text and does not rely on animation.
- Reduce Motion removes non-essential movement while retaining progress information.
- Routine content works without video, audio, or precise gestures.
- Do not claim diagnosis, treatment, recovery, safety, causation, or clinical measurement.
- Avoid shame, streak-loss language, intensity praise, and guaranteed outcomes.
- Professionally reviewed movement and safety copy remain explicit release dependencies.

## 9. Figma implementation requirements

- Pages: Cover, Getting Started, Foundations, separator, Components, separator, Onboarding, Today, Routine, Progress, Profile, Safety & System States, Accessibility.
- Bind all reusable visual properties to local Kineo or Apple iOS variables.
- Use SF Pro text styles; do not substitute Inter.
- Use component instances for repeated controls and cards.
- Build screens with auto layout, fixed 402 pt outer width, scrollable content, and fixed native chrome where appropriate.
- Return and record exact Figma IDs after every creation step.
- Validate every component structurally and visually before composing screens.
- Validate each completed screen and dense subsection with a screenshot.
- Final audit: component instances, bindings, font family, naming, contrast, touch targets, text scaling, prototype paths, and placeholder content.

## 10. Current validation record

Completed outside Figma while the account write limit was active:

- Core-flow visual review.
- Branch and system-state review.
- Accessibility large-text review for representative dense screens.
- Palette contrast checks: core brand/on-white, primary text/on-warm, secondary text/on-warm, and attention text/on-attention surface pass WCAG AA for their intended text sizes.
- Corrected `Similar + Okay` to Balanced.
- Corrected safety storage to remain per area while unresolved state gates all new Kineo routines.
- Labeled prototype movement media and names as non-production.
- Removed a paused-sheet/home-indicator collision.

Still requiring Figma verification:

- Semantic Apple-variable imports and bindings.
- SF Pro text and effect styles in the target file.
- Reusable component sets and properties.
- All screen frames and prototype connections.
- Screenshot, naming, unresolved-binding, and final accessibility audits.
