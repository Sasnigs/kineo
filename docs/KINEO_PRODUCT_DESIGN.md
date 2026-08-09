# Kineo Product Design Document

| Field | Value |
| --- | --- |
| Version | 0.5 |
| Status | **Approved for Prototype Implementation** |
| Product | Kineo |
| Working line | **Daily movement that adapts to how you feel.** |
| Initial platform | Native iPhone app |
| Initial market | United States |
| Last updated | August 7, 2026 |

> This is a living product and engineering specification. Version 0.5 authorizes prototype implementation against this contract. Public distribution still requires the separate release gates and **1.0 — Release-Ready Design**.

## Document Lifecycle

This document evolves through explicit review stages:

| Version | Purpose | Exit condition |
| --- | --- | --- |
| 0.1 | Product contract and first complete draft | Core concept, boundaries, accepted decisions, and open questions are visible |
| 0.2 | User experience | Onboarding, Today, guided routine, feedback, Progress, and Profile flows are decision-complete |
| 0.3 | Technical behavior | Data model, deterministic rules, offline behavior, HealthKit boundaries, and failure states are decision-complete |
| 0.4 | Prototype readiness review | Placeholder content and technical defaults are approved; remaining launch issues are separated |
| 0.5 | Approved for prototype implementation | No prototype implementation blocker remains |
| 1.0 | Release-ready design | Production content, safety, privacy, and App Store gates are closed |

Every revision must update the Decision Register, Open Decisions, and Revision History. A rejected or deferred feature is recorded rather than silently removed.

## 1. Executive Summary

Kineo is a consumer daily movement companion for adults who self-manage recurring neck or back discomfort. It answers one practical question:

> **What movement should I do today, and how much?**

Unlike a static stretching library, Kineo creates a short guided routine from the user's current check-in, active body areas, and previous routine responses. Optional HealthKit information may appear separately as personal context but never controls the routine. Version one uses deterministic and explainable rules. It does not diagnose a condition, treat pain, measure recovery, calculate physical capacity, or generate exercises.

The product is local-first and works offline. Kineo does not transmit check-in answers, body areas, HealthKit-derived values, routine responses, or free text in version one. Privacy-minimized remote diagnostics and generic event counts may be used only within the boundaries in this document.

### Product thesis

People with recurring discomfort often experience day-to-day variation, while the movement guidance available to them is commonly static, generic, or dependent on the user choosing a routine without context. Kineo's differentiated value is not the size of its exercise library. Its value is a short, transparent feedback loop:

```text
Daily check-in -> bounded routine selection -> guided completion -> response feedback -> future adaptation
```

### Version-one outcome

A user can open Kineo, complete a very short check-in, understand why a routine was selected, perform a guided routine, report how it felt, and see patterns over time without an account or internet connection.

## 2. Product Contract

### 2.1 Initial user

Kineo version one is designed for:

- Adults aged 18 or older in the United States.
- People experiencing recurring, non-acute neck or back discomfort.
- People currently managing their movement independently rather than following an active clinician-controlled rehabilitation plan.
- People who want daily guidance and find generic videos, static routines, or exercise libraries insufficiently adaptive.

The target is defined by the user's recurring problem, not their occupation. It may include office workers, students, drivers, caregivers, athletes, and others.

### 2.2 Initial body areas

Kineo supports three user-facing areas:

1. Neck
2. Upper or mid-back
3. Lower back

Each session has one required **primary area** and at most one optional **secondary area**. The primary area drives routine composition. The secondary area adds a bounded module; it does not create an unrestricted combined routine. A user cannot select all areas in a single version-one session.

### 2.3 Core user job

The primary job is:

> Help me choose an appropriate short movement routine for how I feel today without making me search through a library.

Secondary jobs are:

- Help me remain consistent without pressuring me to exercise every day.
- Help me remember how different routines felt.
- Help me observe patterns in my own check-ins and routine history.

### 2.4 What Kineo is

- A consumer movement-planning and habit-support product.
- A bounded selector of pre-authored routines.
- A personal record of check-ins, completed routines, and reported responses.
- A transparent system whose recommendations can be explained in plain language.

### 2.5 What Kineo is not

Kineo does not:

- Diagnose, screen for, predict, cure, treat, mitigate, or prevent a disease or injury.
- Replace a physician, physical therapist, or other qualified professional.
- Determine whether movement is medically safe for a particular person.
- Claim to measure pain tolerance, readiness, recovery, range of motion, or physical capacity.
- Provide medication guidance, emergency triage, or postoperative rehabilitation.
- Create exercises through generative AI.
- Claim that a Quick routine is physiologically equivalent to a Standard routine.

Changing marketing language alone does not establish these boundaries. The implemented behavior, content, explanations, App Store listing, notifications, and support materials must all remain consistent with this product contract.

### 2.6 Regulatory posture

Kineo's regulatory classification is unresolved. This document does not claim that Kineo qualifies for the FDA general-wellness exclusion merely because it avoids medical terminology.

Prototype design may continue using the consumer movement product contract. Before public release, a qualified regulatory assessment must evaluate the complete intended use, routine-selection behavior, production content, explanations, marketing, and user-facing claims.

If that assessment determines that the proposed behavior falls outside the intended consumer-product posture, public release is blocked until the product specification is revised or an appropriate regulated pathway is approved. Disclaimers do not substitute for this assessment.

## 3. Product Principles

1. **The user's report determines the plan.** Passive data may add context but does not change routine selection.
2. **Bounded personalization beats invented precision.** Kineo uses a small number of understandable levels and pre-approved routines.
3. **A pause is valid participation.** The product does not use shame, lost-progress warnings, or intensity rewards.
4. **Explain the choice.** A user should understand the main inputs behind a routine without seeing an artificial readiness score.
5. **Request less data.** Permissions are optional, requested in context, and never required for the core experience.
6. **Core use is offline.** Connectivity problems must not prevent a check-in, routine, feedback, or progress review.
7. **Health correlations are not causation.** Trends describe what the user reported; they do not claim why it happened.
8. **Professional content is a release requirement.** Placeholder exercises are acceptable only during internal prototyping.

## 4. Information Architecture

Kineo has three primary tabs.

### 4.1 Today

Today is the product's main experience:

1. View the currently selected body areas.
2. Complete the daily check-in.
3. Receive a Gentle, Balanced, or Active routine.
4. Read a short “Why this routine?” explanation.
5. Select Quick or Standard duration.
6. Start, pause, modify, or end the guided routine.
7. Record Better, Same, or Worse feedback.

The app does not lead with a browseable routine library.

### 4.2 Progress

Progress combines personal patterns with flexible consistency:

- Check-in history.
- Completed and paused routines.
- Gentle, Balanced, and Active history.
- Better, Same, and Worse responses by body area.
- Weekly consistency goal.
- Optional HealthKit context when permission and sufficient data exist.

Progress must not state or imply that sleep, steps, workouts, or a particular exercise caused a change in discomfort.

### 4.3 Profile

Profile contains:

- Primary and secondary body-area preferences.
- Routine preferences.
- Reminder settings.
- HealthKit connection/context state and explanation, without claiming that denied read access can be distinguished from no matching data.
- Privacy, safety, support, data deletion, and app information.

No Kineo account is required in version one.

## 5. Onboarding

Onboarding is progressive. It obtains only the information needed to produce the first routine.

### 5.1 Initial onboarding

1. Product promise and consumer-product scope.
2. Confirm the user is 18 or older.
3. Select a primary area.
4. Optionally select one secondary area.
5. No routine preference is requested in the initial prototype. A later content requirement may add an explicit preference in Profile, not silently extend onboarding.
6. Review and acknowledge the one-time safety screen.
7. Enter Today and complete the first check-in.

### 5.2 Deferred onboarding prompts

- HealthKit connection appears after the user has experienced the check-in and can see how optional context would be used.
- Reminder permission appears when the user chooses a preferred reminder window.
- Any future Kineo-controlled analytics choice appears only after its separate data-flow design is approved, and never during the initial prototype. If later added, it is optional, off until the user opts in, and changeable in Profile.

### 5.3 Safety acknowledgment

The safety screen must be concise and professionally reviewed. Its purpose is to define Kineo's limits, not certify that a user is safe to exercise.

It must communicate that Kineo is not intended for a new injury, sudden or unusual symptoms, postoperative rehabilitation, or emergencies; users should stop a routine if they feel worse or something feels wrong and seek appropriate professional help when needed.

An always-accessible safety control is present during guided routines. Activating it ends or pauses the session and displays the approved guidance. Kineo does not attempt to diagnose the reported issue.

Any usability or research session involving someone outside the product team counts as external prototype testing. The safety acknowledgment, conditional branch, Attention Required state, and routine safety control may be exposed in that testing only with professionally reviewed interim guidance. If that guidance is unavailable, participants must not receive a functional build that accepts check-ins or starts routines; testing is limited to isolated, non-functional mockups that cannot enter those paths.

### 5.4 Conditional safety branch

The normal check-in does not include a full daily safety checklist. A conditional question appears only when an active area is reported as Worse or Limited:

> Is this new, sudden, or unusual for you?

- **No:** Continue with the Gentle result or allow Pause Today.
- **Yes:** Do not generate a routine for the current session. Explain that Kineo cannot guide a new or unusual change and show professionally approved next-step guidance.
- **Not sure:** Use the same behavior as Yes.

Yes or Not sure places Kineo in an **Attention Required** state stored locally. On the next visit, Kineo asks whether the area has returned to the user's usual recurring pattern:

- **Yes:** Clear Attention Required and resume the normal check-in.
- **No or Not sure:** Keep withholding routines and repeat the approved guidance.
- **Selected by mistake:** Start a fresh correction check-in. Keep Attention Required until the user submits a structurally complete corrected answer that either has no conditional trigger or answers No to the required conditional question. Abandoning correction, or answering Yes/Not sure again, keeps the block.

While any Attention Required state remains unresolved, Kineo withholds every new routine, even if the user changes selected areas. The three supported neck/back regions are adjacent, and Kineo has no reviewed basis for assuming that a routine for another region is isolated from the flagged change.

Kineo relies on honest self-reporting and does not attempt to verify, diagnose, or permanently lock the user. It must nevertheless respond consistently to the information the user provides. The exact user-facing wording requires professional review before public release.

## 6. Daily Check-In

The daily check-in uses two prompts. It must not become a long symptom questionnaire.

### Prompt 1: change

> How does this area feel today?

- Better
- Similar
- Worse

For a user's first check-in, the comparison is “compared with your recent usual.” For later check-ins, it is “since your previous Kineo check-in.”

### Prompt 2: movement comfort

> How comfortable do you feel moving today?

- Limited
- Okay
- Good

When a secondary area is active, the interface presents the same two prompts as compact rows for each area. This remains two prompts, with at most four taps. The primary area must be answered. The secondary area can be removed or skipped only before a Worse or Limited answer triggers its conditional safety question; after that trigger, the question must be resolved so omission cannot become a bypass.

### Duration is separate

Available time is not treated as evidence about the user's condition. After Kineo selects the level, the user chooses:

- **Quick:** a complete short routine designed for limited time.
- **Standard:** the normal complete routine.

The duration choice changes volume and composition, not the selected Gentle, Balanced, or Active level. Internal prototype fixtures use five minutes for Quick and ten minutes for Standard solely to test timing and composition. Exact production durations remain a content and professional-review gate.

## 7. Deterministic Selection Engine

Version one uses an auditable rules engine. The engine returns the same result for the same inputs and routine catalog.

### 7.1 Inputs, in priority order

1. Safety state.
2. Primary and optional secondary area.
3. Current check-in for each active area.
4. Region-specific routine history and prior response.
5. Availability of an approved routine and alternative movements.

### 7.2 Base level for each area

Before calculating a level, the engine evaluates the safety state:

- **Normal:** Continue to the check-in mapping.
- **Attention Required:** Return no routine and the approved guidance state.
- **Safety control activated during a routine:** Stop or pause the active session, record it as incomplete, and show the approved guidance state.

The provisional version-one mapping is:

| Change | Movement comfort | Base result |
| --- | --- | --- |
| Worse | Any value | Gentle |
| Any value | Limited | Gentle |
| Better | Good | Active if unlocked; otherwise Balanced |
| Any other combination | Any remaining value | Balanced |

These are product rules, not clinical conclusions.

For a two-area session, the overall routine level is the more conservative of the two area results. For example, Balanced for the primary area plus Gentle for the secondary area produces a Gentle combined routine.

### 7.3 Active unlock

Active is unavailable to a first-time user for a body area. It becomes available only after that area has sufficient completed Gentle or Balanced routine history with acceptable feedback.

For deterministic prototyping, the provisional rule is two completed Gentle or Balanced routines for that area, each with a recorded Better or Same response. A Worse response for the area resets this qualifying count to zero. A completion with skipped feedback, a stopped routine, Pause Today, or history from another area does not qualify. This is a product progression rule, not a measurement of physical capacity.

The count and qualifying feedback remain versioned configuration values. The production threshold requires content and professional review and blocks version 1.0 approval.

### 7.4 User override

- A user can always choose a gentler level.
- A user can choose a more active level only when that level is unlocked and allowed by the current check-in.
- The user cannot override a safety stop.
- Kineo does not tell the user that a locked level would be unsafe; it says the level is unavailable based on the current Kineo plan.

### 7.5 Previous response

The most recent recorded response for the area is the only previous response used directly by version one. A Worse response clears the area's qualifying Active-unlock count, so Active remains unavailable until the user rebuilds that count under section 7.3. The current check-in still determines whether the result is Gentle or Balanced. Skipped feedback and incomplete routines are not interpreted as Better, Same, or Worse.

### 7.6 HealthKit context

HealthKit is optional and secondary. Version one may read:

- Sleep analysis for sleep duration.
- Step count.
- Recent workout type and duration.
- Apple Exercise Time, when available.

Rules:

- HealthKit compares recent values with the user's own rolling baseline, never a universal definition of good sleep or normal activity.
- No baseline-relative context is shown until sufficient valid personal data exists.
- HealthKit does not increase, decrease, select, unlock, or lock a routine level.
- HealthKit does not change the routine's exercises, duration, repetitions, alternatives, or explanation.
- Missing, denied, stale, or inconsistent HealthKit data is ignored without blocking the user.
- HealthKit context is visually separated from “Why this routine?” so users do not infer that it controlled the plan.

The baseline window and minimum valid-day count are intentionally unresolved in version 0.1. They require explicit definition and review before HealthKit context is implemented.

The initial prototype shows no HealthKit context in Today or Progress. A future approved implementation may place a separate context card in either surface, but its exact placement, minimum-data state, and copy require the HealthKit addendum before the feature is enabled.

### 7.7 Explanation output

Every selected routine includes two or fewer plain-language reasons. Examples:

- “Gentle was selected because you reported feeling worse today.”
- “Balanced was selected because you feel similar and comfortable moving.”

Explanations must not use medical conclusions, guarantee outcomes, or expose unsupported scores.

### 7.8 Fallbacks

- If no approved two-area routine exists, Kineo prioritizes the primary area and clearly tells the user that the secondary area was not included.
- If no routine exists for the selected area and level, the engine may offer a gentler approved routine. It must never improvise exercises.
- If the local catalog cannot produce an approved routine, Kineo shows an unavailable state rather than silently selecting unrelated content.

### 7.9 Complete decision order

The selector executes these steps in order and stores the decision inputs, rules version, catalog version, and result locally:

1. If any supported area has an unresolved Attention Required state, return no routine regardless of the current area preferences.
2. Require a current check-in for the primary area. Omit a secondary only when it was skipped before any conditional-safety trigger; a triggered secondary must complete its conditional answer.
3. Calculate each answered area's base level from the current check-in.
4. Apply region-specific Active eligibility and the most recent recorded response.
5. Use the more conservative resulting level when two areas are included.
6. Apply a permitted user override to a gentler level, if selected.
7. Let the user choose Quick or Standard without changing the level.
8. Compose only compatible, approved content for the selected areas, level, and duration.
9. If composition fails, use the explicit fallbacks in section 7.8.

State rules:

- **First session or no history:** Active is locked; no response is inferred.
- **Skipped feedback:** Preserve the prior recorded response; do not count the session toward Active unlock.
- **Stopped or abandoned routine:** Record it as incomplete; do not count it toward Active unlock. Any explicit response still becomes the most recent recorded response.
- **Pause Today:** Produce no routine and do not change Active eligibility.
- **Changed body areas:** Keep history by area; never transfer eligibility or responses from one area to another, and never use a preference change to bypass an unresolved Attention state.
- **Multiple sessions in one day:** Each new routine requires a new check-in and creates a separate session record.
- **Catalog or rules update:** Existing history remains, while each past decision retains the version that produced it.

## 8. Routine System

### 8.1 Routine structure

A routine is assembled from versioned, pre-authored content rather than authored separately for every possible area combination. The version-one catalog contains:

- A primary routine template for each supported area and level, with separately authored Quick and Standard variants.
- A short secondary-area module for each supported area and level, also with separately authored Quick and Standard variants.
- A reviewed compatibility matrix specifying which primary templates and secondary modules may be combined.

This creates 9 primary templates and 9 secondary modules, each with two duration variants, before alternatives. It avoids authoring a separate full routine for every ordered two-area combination. A composed routine is still bounded and reproducible; the app never invents a movement or combines unapproved modules.

Each template or module contains:

- Supported body area and primary or secondary role.
- Gentle, Balanced, or Active level.
- Separately authored Quick and Standard variants.
- Ordered movements.
- Instructions and safety cues.
- Timer or repetition behavior.
- Approved alternatives.
- Content version and review status.

Variants may change exercise selection, duration, repetitions, rest, or sequencing only when those changes are explicitly authored and reviewed. The app does not dynamically truncate a Standard routine to create Quick.

Composition rules:

- The primary template supplies the routine structure; a secondary module replaces designated content slots rather than simply extending the session.
- Quick and Standard remain within their approved duration ranges after composition.
- The compatibility matrix must account for equipment, position changes, duplicate movements, contraindication cues, and transition order.
- Feedback is associated with each included area, while movement skips and alternatives retain the module that produced them.
- If a pairing is absent from the compatibility matrix, Kineo serves the primary-area routine and explains that the secondary area was not included.

### 8.2 Guided experience

Each movement supports:

- Demonstration media or illustration.
- Short written instructions.
- Optional audio cue.
- Timer or repetition count.
- Pause.
- Skip.
- Stop routine.
- Select a pre-approved alternative when available.

Skipping may optionally collect a short reason such as “uncomfortable,” “unclear,” or “not enough space.” These values stay local with other routine-response data.

### 8.3 Demonstration content

The preferred production format is short original or properly licensed video. If a suitable provider is unavailable, version one may use professionally reviewed text and static illustrations instead. The product should select one consistent primary format before public release rather than unintentionally mixing incomplete assets.

### 8.4 Placeholder content

Development placeholders may be used to test navigation, timing, state, and selection. They must:

- Be visibly labeled as placeholders in the catalog metadata.
- Never ship in a public production build.
- Avoid claims of clinical verification.
- Be replaceable without changing the selection-engine interface.

## 9. Feedback and Progress

### 9.1 Immediate response

After a completed or stopped routine, Kineo asks for one response per included area:

> How does this area feel after the routine?

- Better
- Same
- Worse

The user can skip feedback. Kineo must not hold completion or progress hostage to an answer.

### 9.2 Delayed response

The next daily check-in captures delayed change. Version one does not add a separate next-day survey or notification.

### 9.3 Flexible consistency

Progress supports a weekly consistency goal rather than a strict exercise streak. A consistency day may include:

- Completing a Quick or Standard routine.
- Starting and intentionally stopping a routine.
- Choosing “Pause today” after a Limited or Worse check-in.

The interface must not reward Active over Gentle, penalize a pause, or imply that more exercise is always better.

### 9.4 Progress presentation

Progress may show:

- Check-in selections over time.
- Routine completion and duration variant.
- Selected level history.
- Response distribution by area and routine.
- Weekly consistency.
- Optional baseline-relative sleep and activity context.

The product may say that events occurred together. It may not claim that one event caused another without appropriate evidence.

## 10. Notifications

- Reminders are optional.
- The user chooses a general reminder window.
- Notification permission is requested only after the user selects a window.
- Version one does not infer the ideal reminder time.
- Notifications use neutral language and do not expose body areas, discomfort, or HealthKit information on the lock screen by default.
- Missing a reminder does not produce shame, urgency, or a lost-streak warning.

Adaptive reminder timing is a roadmap feature that requires sufficient usage data and explicit privacy review.

## 11. Accessibility

Accessibility is part of the version-one product contract because check-in, routine guidance, timing, and safety controls are core tasks.

### 11.1 Interaction requirements

- Onboarding, check-in, routine selection, guided completion, feedback, Progress, and data deletion must be operable with VoiceOver and Voice Control.
- Controls use correct accessibility labels, values, traits, focus order, and state-change announcements.
- No required action depends only on a swipe, drag, precise gesture, haptic, sound, color, or animation.
- Touch targets meet current Apple platform guidance, and routine controls remain usable when the device is positioned away from the user.
- The safety control, pause, skip, alternative, and stop actions remain discoverable without relying on the demonstration media.

### 11.2 Visual and motion requirements

- Text uses Dynamic Type and common tasks remain complete at 200% or greater text size without clipped controls or lost information.
- Text and meaningful graphics meet current contrast guidance.
- Levels, check-in choices, feedback, and progress states use text or shape in addition to color.
- The interface follows the system Reduce Motion preference; decorative or continuous motion is removed or reduced.
- Light and dark appearances must preserve meaning, contrast, and media legibility.

### 11.3 Accessible routine content

- Every demonstrated movement has equivalent concise written instructions.
- Spoken guidance is optional and never the only source of an instruction or safety cue.
- Video with meaningful speech or sound includes synchronized captions; silent demonstrations include an accessible text description.
- Timers expose their state and remaining time accessibly without producing disruptive per-second announcements.
- Exercise content review includes plain-language comprehension and accessibility, not only movement selection.

### 11.4 Validation

Accessibility is tested on physical iPhones across supported screen sizes using VoiceOver, Voice Control, accessibility text sizes, Increase Contrast, Differentiate Without Color, Reduce Motion, light appearance, and dark appearance. Kineo may declare App Store Accessibility Nutrition Label support only for capabilities verified across every common task.

## 12. Data and Privacy Architecture

### 12.1 Local sensitive data

Kineo does not intentionally transmit the following product values in version one:

- Age-eligibility acknowledgment.
- Body-area selections.
- Check-in answers.
- HealthKit-derived values and personal baselines.
- Routine selections and explanations.
- Completion, skip, stop, and alternative history.
- Better, Same, and Worse feedback.
- Progress aggregates and reminder preference.

These values are stored using iOS Complete Protection, excluded from Kineo-controlled cloud synchronization, and marked for backup exclusion using Apple's documented resource mechanism. That marker is the strongest app-controlled mechanism but is not an absolute guarantee about operating-system backup behavior. Raw HealthKit samples are read only as needed and are not copied into Kineo's database; Kineo stores only the minimum derived local context required for display. Health data may separately sync through Apple's services according to the user's Apple settings, which is outside Kineo's control and must not be described as Kineo storage.

### 12.2 Permitted remote services

Remote services may process:

- Crash and performance diagnostics scrubbed of sensitive product values.
- Privacy-minimized product events with no body area, check-in answer, HealthKit-derived value, routine-response value, routine identifier, or free text.

Example permitted events include `onboarding_completed`, `routine_started`, and `routine_completed`. Product copy calls this telemetry **privacy-minimized**, not anonymous. Version one does not attach a Kineo account ID, advertising identifier, stable device identifier, or cross-app identifier. Events are aggregated locally into coarse counts before transmission; properties and time buckets must not reasonably reconstruct an individual's health or usage history. Remote services must not persist raw network metadata as a substitute identifier.

Third-party SDKs are prohibited by default. Any proposed diagnostics or analytics service requires a documented data-flow inventory, SDK inspection, retention limit, deletion process, privacy-policy disclosure, required user consent, and verification that collection remains within this section. Kineo-controlled telemetry is off until the user explicitly opts in, can be disabled in Profile, and never affects product functionality. Apple-managed aggregate analytics and diagnostics follow the user's system sharing settings and must be described separately.

### 12.3 Offline behavior

Without connectivity, users can:

- Complete onboarding after the app and content are installed.
- Check in.
- Generate and complete a routine.
- Record feedback.
- Review Progress.
- Change local preferences.

Permitted telemetry may retry when connectivity returns. Telemetry failure or refusal never blocks product access or changes local data.

### 12.4 Accounts and synchronization

Version one has no Kineo account and no cross-device health-data synchronization. Required accounts and encrypted synchronization are roadmap items. Introducing them requires a new privacy and security design review; it is not merely a login-screen change.

### 12.5 User control

Profile must provide:

- A clear explanation of local and remote data use.
- A way to disconnect HealthKit permissions through the appropriate system flow.
- A way to change the Kineo-controlled telemetry choice, when telemetry exists.
- A way to reset Kineo's local history.
- A way to delete locally stored Kineo data.

Reset History removes check-ins, plan decisions, sessions, feedback, Progress/eligibility projections, and safety-transition history while retaining onboarding, preferences, reminders, and only the minimum current Attention Required row. The confirmation must disclose that exception so reset cannot silently become a safety bypass. Delete All removes every Kineo-owned local record, including current Attention rows, and any pending telemetry. Because transmitted telemetry has no Kineo lookup identifier, it cannot be retrieved as an individual record and expires under the disclosed aggregate-retention policy. The interface must separately explain that Kineo cannot delete data held independently by Apple, including HealthKit source data and Apple-managed diagnostics.

## 13. Product Success Measures

Version one measures product usefulness and engagement, not treatment outcomes. Measurement has two deliberately separate layers.

### 13.1 Remote operational measures

With permitted privacy-minimized telemetry or aggregate App Store analytics, Kineo may measure:

- App launches and stability.
- Aggregate onboarding completion.
- Aggregate routine starts and completions.
- Aggregate Progress opens.

Remote measurement does not attempt to calculate individual retention, streaks, body-area behavior, check-in trends, routine-response distributions, overrides, or HealthKit relationships. Generic event counts cannot prove that the same person returned.

### 13.2 On-device product insights

The app may calculate for the user, entirely on-device:

- Their check-in and Better/Same/Worse distributions.
- Their Quick and Standard use.
- Their pause, skip, completion, alternative, and gentler-override patterns.
- Their consistency and Progress history.

These personal insights are displayed cautiously and are not treatment or recovery outcomes.

### 13.3 Product-learning limitation

Version one intentionally cannot remotely answer which body area, check-in response, routine level, or post-routine response drives retention. Product evaluation begins with aggregate activation and completion, usability testing with non-sensitive scenarios, and voluntary user interviews.

Any later upload, export, or research use of sensitive patterns requires a separate specification covering purpose, explicit opt-in consent, data minimization, withdrawal, retention, access, security, and applicable research or regulatory review. It is not enabled by accepting the general privacy policy or generic analytics.

## 14. Version-One Acceptance Scenarios

1. **First use:** An eligible adult selects a primary area, accepts the product boundary, completes the two-prompt check-in, and receives Gentle or Balanced—not Active.
2. **Secondary area:** A user adds one secondary area, answers the same compact prompts for both, and receives a routine using the more conservative level.
3. **Recurring Worse response:** Worse followed by No produces Gentle regardless of HealthKit context.
4. **New or unusual change:** Worse or Limited followed by Yes or Not sure enters Attention Required and produces no routine.
5. **Attention Required return:** The next visit asks whether the named area returned to its usual recurring pattern before allowing any new routine, including after area preferences change.
6. **Corrected answer:** “Selected by mistake” starts a fresh correction without clearing Attention; a valid completed correction clears the named area's state atomically, while abandoning it or answering Yes/Not sure keeps the block.
7. **Limited movement comfort:** Limited followed by No produces Gentle and offers a visible Pause Today choice.
8. **Active locked:** Better plus Good produces Balanced until Active is unlocked for that body area.
9. **Controlled override:** A user can select a gentler level but cannot select a locked or disallowed higher level.
10. **Missing HealthKit:** The same core flow succeeds with permission denied or no samples available.
11. **HealthKit context only:** In a future build enabled by the approved HealthKit addendum, context may appear separately in Today and Progress but produces the same routine as an otherwise identical check-in without HealthKit. The initial prototype shows no HealthKit context.
12. **Two-area catalog gap:** If a combined routine does not exist, Kineo serves the primary area and explains that the secondary area was not included.
13. **Routine control:** Pause, skip, stop, and approved-alternative actions preserve session state and do not invent content.
14. **Feedback:** Better/Same/Worse is stored separately for each included area; skipping feedback is allowed.
15. **Offline:** Check-in, selection, routine playback from installed assets, feedback, and Progress work in airplane mode.
16. **Reset and deletion:** Reset History removes check-ins, routines, feedback, Progress, and safety-transition history while retaining the minimum current Attention row; Delete All removes those values plus every current Attention row and all other Kineo-owned local data before returning to onboarding.
17. **Skipped feedback:** A completed routine without feedback does not qualify for Active unlock and does not replace the most recent recorded response.
18. **Stopped routine:** A stopped routine remains incomplete; an explicit response is retained, but the routine does not qualify for Active unlock.
19. **Area-specific history:** Changing the primary area does not transfer Active eligibility or responses from another area.
20. **Repeat session:** Starting another routine on the same day requires a new check-in and creates a distinct auditable decision.
21. **Bounded composition:** A two-area session uses only an allowed template-module pairing and stays within the chosen duration range.
22. **Incompatible composition:** An unapproved pairing produces a disclosed primary-only routine rather than an improvised combination.
23. **Privacy boundary:** Network inspection shows no body area, check-in, HealthKit-derived value, routine identifier, response, free text, or stable Kineo user/device identifier leaving the app.
24. **Protected storage:** Sensitive local records use Complete Protection and carry the documented backup-exclusion marker; representative backup inspection finds no Kineo sensitive record without claiming control over all OS backup behavior.
25. **Accessible core flow:** Every common task can be completed with VoiceOver, Voice Control, and accessibility text sizes without losing instructions or controls.
26. **Accessible routine:** A user can understand and control the timer and movement sequence without seeing video, hearing audio, distinguishing color, or performing a precise gesture.
27. **Active reset:** A Worse response resets the area's qualifying Active count; skipped feedback or a stopped routine cannot rebuild it.
28. **Telemetry choice:** Before opt-in and after opt-out, network inspection shows no Kineo-controlled product telemetry, with no loss of product functionality.

## 15. Roadmap and Excluded Ideas

### 15.1 Deferred roadmap

- AI ranking of pre-approved routines after real usage data exists.
- Required accounts and encrypted cross-device synchronization.
- Clinician-supported users and clinician-facing workflows.
- Additional body areas.
- Adaptive reminder timing.
- Clinician-oriented export, only after clinician demand is validated.
- Production content partnerships.
- Explicit opt-in product research or sensitive-data export under a separately approved protocol.
- Optional trigger tags or notes, only if later evidence shows that their value justifies extra check-in friction and sensitive-data scope.
- A breathing or calm-reset experience, only after its user job, content, and placement are separately defined.

Future AI must:

- Rank only bounded, approved content.
- Never override safety or user-report rules.
- Be evaluated against the deterministic baseline.
- Demonstrate a measurable product benefit before controlling recommendations.
- Use a separately approved privacy and data-consent model.

### 15.2 Excluded from version one

- Camera-based pose or joint analysis.
- Vision 3D or Google MediaPipe movement assessment.
- Numerical readiness or recovery scores.
- Generative exercise creation.
- Community rooms.
- Apple Music integration.
- Medication or emergency guidance.
- Medical, diagnostic, rehabilitation, treatment, or injury-prevention claims.

## 16. Open Decisions and Release Gates

### 16.1 Prototype technical resolutions

The technical-design set resolves the former implementation ambiguities below. These are prototype design decisions, not authorization to begin coding or evidence that a public-release gate is closed.

| Decision | Prototype resolution | Owning technical document |
| --- | --- | --- |
| Region-selection interface | Accessible text choice cards; no body map | TD-00, TD-06 |
| Optional trigger logging | Deferred from version one | TD-00 |
| Breathing/calm reset experience | Deferred from version one | TD-00 |
| Placeholder routine catalog | Schema-complete, visibly non-production internal fixture; distribution builds reject it | TD-04 |
| Prototype duration values | Five-minute Quick and ten-minute Standard internal targets; production values remain gated | TD-04 |
| Template-module composition schema | One ordered replacement slot, explicit ordered-pair compatibility rules, validated duration, and primary-only catalog fallback | TD-04 |
| HealthKit context presentation | Disabled in the initial prototype; requires a separately approved addendum | TD-07 |
| Minimum iOS version | iOS 17.0 for the prototype | TD-00, TD-01 |
| Local persistence technology | SQLite through GRDB 7.10.0 pinned by exact Swift Package Manager version behind repository ports; direct SQLite is the dependency-rejection fallback | TD-01, TD-02 |
| Telemetry implementation | No Kineo telemetry, endpoint, queue, identifier, or third-party diagnostics in the initial prototype | TD-01, TD-02, TD-07 |

In this table, `TD-00` through `TD-08` identify documents in the technical-design set. They are distinct from the `TD-001` through `TD-015` prototype decision IDs in the technical index.

The product owner approved version 0.5 and M1 implementation on August 7, 2026, after TD-08 Gate D0 passed. Later work remains governed by the ordered milestone exits and release gates.

### 16.2 Public-release gates

These decisions may remain open during internal prototyping but must be resolved before version 1.0 and public distribution:

| Decision | Why it matters | Required owner/evidence |
| --- | --- | --- |
| Production exercise library | Kineo cannot publicly ship placeholders or unlicensed media | Content agreement plus qualified professional review |
| Routine definitions | Gentle/Balanced/Active and Quick/Standard need authored meaning per body area | Content specialist and product approval |
| Catalog completeness and compatibility | Every supported primary template, secondary module, alternative, and allowed pairing must be available and reviewed | Automated matrix audit plus content and professional approval |
| Quick and Standard duration | Duration cannot be improvised by the UI | Approved content specification |
| Production Active unlock threshold | Current concept intentionally avoids unsupported precision | Product test plus professional review |
| Production HealthKit baseline presentation | Baseline-relative context needs reproducible, non-misleading behavior | Technical analysis, testing, and review |
| Safety copy and behavior | Disclaimer language alone is insufficient | Qualified legal/regulatory and professional review |
| Regulatory intended-use assessment | Consumer wording alone does not determine whether symptom-driven exercise selection is a regulated function | Qualified U.S. digital-health regulatory assessment of the complete product and claims |
| Demonstration format/provider | Determines content pipeline and offline package size | Licensing/procurement decision |
| Analytics and crash vendor | Vendor must not collect sensitive values | Privacy and security review |
| Privacy implementation verification | Local-only and telemetry claims must match runtime behavior | Storage inspection, backup test, network inspection, retention/deletion test, and privacy review |
| Accessibility validation | Common tasks and routine content must remain usable with supported assistive settings | Physical-device test matrix, remediation, and accurate Accessibility Nutrition Labels |
| App Store and privacy materials | Required before distribution | Legal/privacy review and App Store configuration |

## 17. Decision Register

| Decision | Status | Rationale |
| --- | --- | --- |
| Native iPhone app | Accepted | Best initial platform fit; does not require exclusive use of Apple technologies |
| Consumer movement positioning | Accepted | Preserves adaptive movement without claiming that regulatory classification is already settled |
| Regulatory classification | Unresolved release gate | Requires review of the implemented behavior, content, intended use, and claims before public distribution |
| Adults 18+, U.S. first | Accepted | Limits initial consent, localization, and market complexity |
| Self-managing recurring neck/back discomfort | Accepted | Defines the initial user without assuming an occupation |
| Primary plus optional secondary area | Accepted | Supports multiple concerns without an unbounded routine |
| Modular multi-area composition | Accepted | Preserves neck/back coverage while bounding catalog size through reviewed templates, modules, and compatibility rules |
| Two-prompt check-in | Accepted | Minimizes daily friction |
| Conditional safety branch | Accepted | New, sudden, unusual, or uncertain changes enter Attention Required instead of generating a routine |
| Global unresolved-Attention gate | Resolved for prototype design | Any current flag blocks all new routines because isolation among supported adjacent neck/back regions is unproven |
| Two-step mistake correction | Resolved for prototype design | Starting correction does not clear the gate; only a valid submitted correction does, so abandonment cannot bypass it |
| Deterministic rules first | Accepted | Auditable baseline before AI ranking |
| Gentle/Balanced/Active | Accepted | Useful variation without a false numerical score |
| HealthKit as context only | Accepted | Preserves optional sleep and activity visibility without using them to control routines |
| Guided routine with user controls | Accepted | Supports completion and personal agency |
| Today/Progress/Profile | Accepted | Keeps daily guidance central |
| Local-first and offline | Accepted | Protects sensitive data and improves reliability |
| Split measurement model | Accepted | Keeps sensitive personal insights on-device and limits remote measurement to privacy-minimized operational counts |
| No stable Kineo analytics identifier | Accepted | Prevents generic telemetry from becoming individual health or usage histories |
| No account in version one | Accepted | Avoids unnecessary onboarding and cloud scope |
| Accessibility as product contract | Accepted | Core movement and safety tasks must remain usable with common iPhone assistive technologies and settings |
| Placeholder content for development only | Accepted | Enables product prototyping without treating placeholders as shippable content |
| Vision-based movement check | Excluded | Technical feasibility does not establish clinical validity or product need |
| Accessible text area selector | Resolved for prototype design | Avoids ambiguous anatomy interaction and unnecessary body-map assets |
| Trigger logging | Deferred | Not required for selection and would expand daily friction and sensitive-data scope |
| Breathing/calm reset | Deferred | Its user job, content, and placement are not part of the core loop |
| Prototype timing | Resolved for prototype design | Five-minute Quick and ten-minute Standard fixtures make timing deterministic without setting production claims |
| HealthKit in initial prototype | Off | Baseline and presentation behavior require a separate approved design |
| Prototype persistence | Resolved for prototype design | Exactly pinned GRDB 7.10.0 backed by SQLite provides explicit constraints, migrations, transactions, file handling, and auditable deletion |
| Prototype telemetry | None | Avoids an unapproved data flow and preserves a verifiable zero-network core |

## 18. References and Policy Inputs

These sources inform the product boundaries; they do not constitute legal advice:

- [FDA: General Wellness — Policy for Low Risk Devices (January 2026)](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple: Protecting HealthKit User Privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)
- [Apple HealthKit Data Types](https://developer.apple.com/documentation/healthkit/data-types)
- [Apple: Overview of Accessibility Nutrition Labels](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/)
- [Physitrack Developer Information](https://www.physitrack.com/en-gb/developer-information)

## 19. Revision History

| Version | Date | Status | Summary |
| --- | --- | --- | --- |
| 0.5 | August 7, 2026 | Approved for Prototype Implementation | Recorded product-owner approval after Gate D0 passed; authorized M1 while preserving later milestone and release gates |
| 0.1.7 | August 6, 2026 | Draft | Clarified prototype onboarding, external-participant safety-copy gating, future HealthKit placement, and technical-document identifiers after independent review |
| 0.1.6 | August 6, 2026 | Draft | Added the implementation-ready TD resolutions while preserving explicit coding approval; aligned prototype durations, persistence, HealthKit/telemetry state, deferred features, and implementable backup wording |
| 0.1.5 | August 6, 2026 | Draft | Resolved remaining critical design gaps: bounded multi-area composition, complete deterministic states, privacy-compatible measurement, precise local-data and telemetry boundaries, and accessibility requirements |
| 0.1.4 | August 6, 2026 | Draft | Removed HealthKit from routine selection; retained it only as optional, separately presented context |
| 0.1.3 | August 6, 2026 | Draft | Added conditional safety branching, Attention Required state, correction flow, and acceptance scenarios |
| 0.1.2 | August 6, 2026 | Draft | Preserved the adaptive consumer product while making regulatory classification an explicit unresolved public-release gate |
| 0.1.1 | August 6, 2026 | Draft | Removed non-product strategy and commercial content |
| 0.1 | August 6, 2026 | Draft | Established product contract, version-one behavior, boundaries, data posture, roadmap, and implementation blockers |
