# Kineo Project Handoff and Owner Working Agreement

| Field | Value |
| --- | --- |
| Purpose | Preserve product intent, owner preferences, engineering rules, and current project state across sessions and developers |
| Owner | Seki / Sasnigs |
| Repository | `Sasnigs/kineo` |
| Local path | `/Users/seki/Desktop/kineo` |
| Last updated | August 10, 2026 |

## 1. How to use this document

This is an operating handoff, not a replacement for the product or technical specifications.

Use sources in this order:

1. The owner's latest explicit instruction.
2. Safety, privacy, and product boundaries in `KINEO_PRODUCT_DESIGN.md`.
3. Resolved technical contracts in `technical/00_TECHNICAL_DESIGN_INDEX.md` and TD-01 through TD-08.
4. Authorized scope and order in `KINEO_IMPLEMENTATION_MILESTONES.md`.
5. Repository-wide engineering rules in `../AGENTS.md`.
6. Working preferences and context in this handoff.
7. Best engineering judgment for anything still reversible and inside the authorized scope.

Rules labelled **Explicit** came directly from the owner and should be treated as binding until superseded. Items labelled **Inferred** are strong working preferences derived from repeated choices; do not let an inference override an explicit instruction or an authoritative product contract.

“Do not assume” means verify repository state, requirements, platform behavior, dependencies, and changing external facts. It does not mean stopping for every minor choice. Within authorized scope, make the safest reversible decision, record material assumptions, and continue.

## 2. Current project snapshot

### Product

Kineo is a local-first native iPhone movement companion for adults who self-manage recurring, non-acute neck or back discomfort. It helps answer:

> What movement should I do today, and how much?

Its differentiation is a short, explainable feedback loop—not a large stretching library:

```text
Short check-in -> deterministic routine selection -> guided routine -> optional response -> later adaptation
```

Kineo is not a diagnostic, treatment, rehabilitation, recovery-measurement, readiness-scoring, or generative-exercise product.

### Delivery state

| Item | State |
| --- | --- |
| M1 — Project foundation | Merged to `main` in PR #1 |
| M2 — Domain and persistence | Complete; draft PR #2 open with passing CI |
| Current branch | `agent/m2-domain-persistence` |
| M2 implementation commit | `e6d76b0` |
| M3 — Selection and safety engine | Not authorized at the time of this handoff |
| Package validation | 84 tests passed, 0 failed |
| App-hosted validation | 2 passed, 0 failed, 1 expected physical-device protection skip |

PR #2: `https://github.com/Sasnigs/kineo/pull/2`

### Local tools and workflow support

- Xcode is installed and the native iPhone project builds.
- GitHub CLI is installed and authenticated as `Sasnigs`; authentication can expire and must be verified before publishing.
- Swift language, API design, concurrency, and testing review skills are installed locally.
- The Grilling skill is installed for deliberate idea or plan stress-testing when requested.
- GitHub Actions automatically runs build and test checks for pull requests.

## 3. Owner's product rules

### Explicit: preserve the central problem

- The product must remain focused on helping people decide what movement to do for recurring neck and back discomfort.
- Do not reduce Kineo to another generic stretching or exercise-library app.
- The original differentiator—brief current-state input, bounded selection, explanation, guided completion, and feedback—must survive feasibility and safety changes.
- Build the actual product first. Monetization, subscriptions, paywalls, acquisition strategy, and business-model analysis are secondary and do not belong in the current product or technical design documents.

### Explicit: target and positioning

- The target is adults aged 18 or older who experience the supported issue; it is not limited to office workers.
- Supported user-facing regions are Neck, Upper or mid-back, and Lower back.
- Version one permits one primary area and at most one secondary area per session. Supporting three selectable regions does not mean combining all three in one routine.
- Position the product as consumer movement planning and wellness support, not treatment for chronic pain or pain generally.
- Avoid diagnosis, treatment, cure, prevention, rehabilitation, readiness, capacity, range-of-motion, and recovery claims.
- Being 18+ does not transfer product safety, legal, or clinical responsibility to the user.

### Explicit: technical and clinical restraint

- Remove camera-based 3D pose or joint analysis from the approved scope.
- Do not use a model merely because it is technically capable. Any future clinical or safety-critical capability requires evidence, professional review, a regulatory assessment, and an explicit design change.
- Do not assume Google, Apple, or another vendor's vision model is clinically approved for Kineo's intended use.
- Kineo may rely on honest self-reporting because it cannot detect whether a user is lying. It must still consistently enforce the safety state produced by the answers it receives.
- Safety blocks cannot be bypassed by changing areas, shortening duration, choosing an override, abandoning correction, or manipulating another non-safety preference.

### Explicit: local-first native product

- The implementation target is a native iPhone app using Swift and SwiftUI.
- Do not port the product to web as a substitute for the native implementation unless the owner explicitly changes the platform decision.
- The technology is not restricted to Apple-provided frameworks. Prefer the most suitable dependable technology when it respects architecture, privacy, licensing, offline behavior, and release constraints.
- Core use must work locally and offline without an account.
- Functionality and a correct end-to-end flow come before visual polish.
- Figma or final UI refinement may follow once functionality is stable; written UX specifications are acceptable during implementation.

### Explicit: low-friction experience

- Progressive onboarding is the default.
- Ask only for information needed at the point it becomes useful.
- The daily check-in must remain short: two normal prompts per active area, with a conditional safety question only when triggered.
- Do not turn the check-in into a long symptom questionnaire.
- Available time is not evidence of recovery, severity, readiness, or capacity.
- Quick and Standard are complete authored variants chosen after the routine level; duration must not silently change the selected level.
- More advanced adaptation should follow real usage evidence, not unsupported assumptions.

## 4. Owner's collaboration rules

### Explicit: communication

- Keep responses concise and lead with the outcome.
- Explain unfamiliar concepts plainly. The owner wants to learn while building, but building remains the priority.
- Do not automatically agree with the owner. Correct inaccurate assumptions with evidence and a clear reason.
- Never hide uncertainty behind confident wording.
- When a real blocking decision is required, explain exactly what is being decided and provide two or three selectable choices with the recommended choice first.
- Do not ask for routine intermediate permission. Choose the recommended path and continue.
- At completion, surface only critical decisions, risks, or deviations that genuinely merit owner review.

### Explicit: autonomy and authorization

- A milestone or implementation phase must be authorized before coding begins.
- Once scope is authorized, work autonomously toward success without repeatedly pausing for approval.
- Do not interpret “continue,” “finish,” or “go with recommended” as permission to expand into a different milestone, platform, external service, clinical feature, or public release.
- Stop for owner input only when a choice is irreversible, changes product intent, changes approved scope, incurs meaningful external consequences, or cannot be resolved safely from the documents and repository.
- Safe, reversible implementation details should be resolved using evidence and best judgment.

### Explicit: reviews and decisions

- Think critically before implementing and resolve blockers with the best supported recommendation.
- Review documents and implementation before calling them final.
- During a decision-led review, critical findings may be explained one at a time so the owner can understand them.
- During an already authorized build, fix all in-scope issues and report only remaining critical decisions.
- Use independent reviewers or multiple agents when the task benefits from genuinely independent bounded reviews, especially for documentation gates, architecture, safety, persistence, and testing.
- When requested, Claude Code may provide an independent review. Preserve actionable findings and verify them against the repository rather than accepting them automatically.

## 5. Engineering rules

### Explicit: implementation quality

- Do not use magic numbers. Give domain limits, durations, sizes, ranks, schema versions, and other meaningful values descriptive constants.
- Implement proper error handling.
- Prefer typed errors at module boundaries.
- Do not silently swallow failures, use recoverable force unwraps, use `try!`, or hide a failed persistent store behind empty replacement data.
- A cleanup failure may preserve the primary failure only when the resulting state remains safe and the behavior is explicit and tested.
- Use domain types and invariants to prevent invalid states rather than relying only on UI checks.
- Keep safety and selection behavior deterministic, explainable, and independent of UI code.
- Do not implement speculative abstractions or future features before their milestone owns them.

### Explicit: tests and verification

- Unit tests are required.
- Test the full end-to-end flow appropriate to the milestone, not only isolated happy paths.
- Persistence work must test real SQLite behavior, migrations, transactions, rollback, corruption, retry, reset, deletion, protected-data handling, and recovery.
- After Swift coding, apply the installed Swift language, API-design, concurrency, and testing guidance as relevant.
- Run focused checks first, then the full relevant suite.
- A task is not complete merely because it compiles.
- Do not report a skipped device-only check as a pass; label expected environment skips precisely.

### Explicit: architecture and dependencies

- Preserve inward dependency direction: App composition -> UI and Infrastructure -> Core contracts.
- UI must call domain use cases rather than reimplement safety or selection rules.
- Prefer local-first, privacy-minimizing dependencies.
- Pin consequential dependencies, review their license and maintenance state, and document rejection fallbacks.
- Apple-native technology is not automatically preferred when a better supported choice exists, but every dependency must earn its complexity.

## 6. Documentation rules

### Explicit

- Create and review product and technical design documents before implementing ambiguous core behavior.
- Split technical design into focused documents with clear ownership and minimal overlap.
- Each technical design document should contain a simple architecture diagram when a diagram materially clarifies the design.
- Cut verbosity that increases ambiguity; keep necessary detail for implementation.
- Product-building documents must not contain business-model or monetization sections.
- Keep Markdown documentation tracked in Git. Do not place the project documentation in `.gitignore`.
- Do not link the design documents from the README unless the owner explicitly reverses this choice.
- Update milestone and technical-document status when implementation evidence changes.
- Run the documentation gate before starting a newly gated implementation phase.

### Document ownership

- `KINEO_PRODUCT_DESIGN.md`: product intent, boundaries, target user, claims, features, acceptance scenarios, and release gates.
- `KINEO_UX_DESIGN_SPEC.md`: screen behavior, progressive disclosure, navigation, copy intent, and accessibility interaction.
- `technical/00_TECHNICAL_DESIGN_INDEX.md`: cross-document decisions, invariants, dependencies, and unresolved gates.
- TD-01 through TD-08: subsystem implementation contracts.
- `KINEO_IMPLEMENTATION_MILESTONES.md`: development order, authorization state, and completion criteria.
- `reviews/`: dated evidence and independent gate findings.
- This file: owner working agreement, project orientation, and session handoff.

## 7. Git and pull-request rules

### Explicit

- Use a feature branch for milestone work rather than pushing directly to `main`.
- Create a pull request for review and CI before merging milestone work.
- A PR should contain multiple logical commits when the work naturally divides into understandable units.
- Do not create artificial commits merely to increase the commit count.
- Prefer commits such as:
  1. Domain behavior plus its tests.
  2. Persistence or service implementation plus its failure-path tests.
  3. App integration and aligned documentation.
- Keep tests with the behavior they validate when practical.
- Use short, descriptive commit messages.
- Keep PR descriptions concise: summary, impact, and validation evidence.
- Confirm the complete staged scope before committing. Never include unrelated user changes.
- Push the feature branch, allow CI to complete, and report whether checks passed, failed, or remain pending.
- Default to a draft PR while work or review is still active; mark ready only when the milestone is genuinely ready for review.
- Do not rewrite already-pushed shared history merely to manufacture a cleaner commit count unless the owner explicitly approves the history rewrite.

## 8. Product and release boundaries that remain open

The following are gates, not permission to invent an answer:

- Professional review of production movement content, alternatives, durations, level meanings, compatibility rules, and safety wording.
- Qualified assessment of intended use and regulatory posture before public release.
- Physical-device proof for protected-data behavior, backup exclusion, deletion, accessibility, and interruption handling.
- Production licensing and media review.
- Any use of HealthKit in selection or presentation beyond the separately approved boundary.
- Any telemetry, account, backend, remote configuration, networking, generative AI, or third-party diagnostic SDK.
- Any camera, pose, movement-quality, range-of-motion, or clinical inference feature.
- Public testing of functional safety paths before professionally reviewed interim wording exists.

Do not treat a technically working prototype as clinical approval, professional content approval, regulatory clearance, or permission for public distribution.

## 9. Inferred working preferences

These are strong patterns, not immutable requirements.

| Preference | Confidence | Practical interpretation |
| --- | --- | --- |
| Product substance over pitch work | High | Prioritize a trustworthy useful product before monetization analysis |
| Evidence over optimism | High | Challenge attractive ideas when feasibility, safety, or approval evidence is weak |
| Momentum without recklessness | High | Continue autonomously on reversible details; pause at real scope or safety boundaries |
| Native simplicity | High | Prefer a clear local iPhone architecture over premature cross-platform support |
| Functional UI before polish | High | Build usable native flows, then refine visual design without changing domain behavior |
| Concise operational updates | High | Report outcomes, current blocker, and next action without narrating every command |
| Learn through milestones | High | Briefly explain what each milestone teaches while keeping delivery central |
| Durable project memory | High | Record decisions and evidence so a new developer can continue without reconstructing chat history |
| Independent challenge | Medium-high | Use critical review to catch a wrong direction, not as ceremony for every small task |

## 10. Common failure modes to avoid

- Turning Kineo into a static browseable stretching library.
- Calling the product “wellness” while implementing medical behavior or claims underneath.
- Treating a disclaimer or 18+ gate as a substitute for safe product behavior.
- Assuming a vendor API or model is clinically approved for Kineo.
- Letting duration, passive data, reminders, telemetry, or device activity affect routine intensity without an approved rule.
- Adding questions to the daily check-in because the information might be interesting.
- Implementing UI-only validation while allowing invalid domain or persisted states.
- Silently recreating data after storage, migration, corruption, protection, reset, or deletion failure.
- Using placeholder content outside the internal prototype boundary.
- Starting the next milestone because it seems like a natural continuation without checking authorization.
- Asking the owner to decide ordinary implementation details that can be resolved safely from evidence.
- Producing long progress messages when a short outcome and blocker are enough.
- Committing directly to `main`, mixing unrelated changes, or making one arbitrary commit per file.

## 11. Start-of-session checklist

1. Read this handoff and `../AGENTS.md`.
2. Read the product, milestone, and owning technical documents for the requested scope.
3. Check the current branch, worktree, upstream, open PR, and CI state.
4. Preserve existing user changes and confirm which milestone is authorized.
5. Identify safety, privacy, persistence, or release boundaries before implementation.
6. State the intended outcome concisely and begin; do not ask non-blocking questions.

## 12. End-of-task checklist

1. Review the diff for scope, magic numbers, unsafe error handling, force unwraps, and dependency-boundary violations.
2. Apply the relevant Swift best-practice reviews after coding.
3. Run focused tests and the full relevant suite.
4. Update authoritative documentation only when behavior or evidence changed.
5. Use logical commits, push only the intended branch, and verify CI when publishing was authorized.
6. Report the outcome first.
7. Surface only critical unresolved decisions, deviations, failed checks, or external gates requiring the owner.

## 13. Recommended next action

Do not begin M3 solely because M2 is complete. First finish review and merge handling for PR #2, sync `main`, then obtain or confirm explicit authorization for M3. Once authorized, implement M3 as a sequence of logical commits centered on the deterministic selection and safety engine and its exhaustive tests.
