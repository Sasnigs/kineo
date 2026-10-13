# C0 Consistency Design Review

| Field | Result |
| --- | --- |
| Date | October 13, 2026 |
| Baseline | `b03bc7363b3a84688b4c8476fb1f69a5636dd2d4` |
| Scope | Product/UX v0.7 proposal, TD-13, owning contract amendments, glossary and C0–C5 sequence |
| Result | Independent documentation review passed; owner acceptance remains open |
| Implementation | No product code, schema migrations, dependencies, participant testing, or telemetry added |

## Product decision

Keep the current bounded movement engine. Add an optional consistency layer:
honest Progress, explicit participation targets, scheduled reminders, easy return,
and one private everyday-activity reflection series. Do not treat dedication as
the sole cause of skipped movement or engagement as proof of pain relief.

The [product design](../KINEO_PRODUCT_DESIGN.md) records the research sources and
claim boundaries. [TD-13](../technical/13_CONSISTENCY_EVERYDAY_FUNCTION.md) records
each decision's user benefit, failure risk, system consequence, and acceptance
contract. [Milestones](../KINEO_IMPLEMENTATION_MILESTONES.md) order C1–C5.

## Independent review and fixes

Two read-only reviewers assessed the delta against the fixed baseline: Spec
(owner intent and product contracts) and Standards (repository rules, document
ownership, readiness and simplicity). Both rechecked the substantive fixes and
reported no remaining Critical/Major finding in the reviewed scope.

| Finding | Resolution and required future evidence |
| --- | --- |
| Offline opt-out could leave alerts active | Durable local suppression and verified cancellation precede Account sync; stale hydration cannot reactivate alerts. `CONS-05` covers outage, relaunch, conflict, reconnect and cleanup failure. |
| Immediate disable conflicted with next-week target changes | Profile owns enablement; immutable decisions own numeric choices. Explicit re-enable, pending replacement/cancellation and cross-week cases; no historical achievement inference. `CONS-01`. |
| Today precedence had no owning Plan-restoration branch | TD-05 section 5.1 owns guarded restoration through server authority. Stale decisions cannot supply a new Plan; failures remain visible. `CONS-03`. |
| Fixed reflection zone and invitation dismissal were unspecified | Profile owns an epoch-fixed calendar and dismissed period; Goals store the immutable zone. Offline local dismissal, Goal replacement and stale Installation limits are explicit. `CONS-04/06`. |
| Sensitive lifecycle and partial-success ambiguity | Reset/export/logout/deletion include new fields; reset cannot reactivate alerts. Committed receipt/cache failure uses idempotent recovery, not duplicate submission. `CONS-06/07`. |

The final wording also restricts initial evaluation to synthetic/non-functional
work and makes setup depend on a completed or actually started-and-stopped Routine.
No feature execution or clinical verification was part of these reviews.

## Documentation gate evidence

| Check | Result |
| --- | --- |
| `git diff --check` | Pass |
| `node Scripts/agent-check.mjs docs` | Pass: repository entry points and task contracts |
| Local Markdown targets in changed documents | Pass |
| Product/UX/TD authority and first-use/offline contracts | Manually reconciled; specific proposed delta remains acceptance-gated |
| Record identity, version, epoch, calendar and erasure ownership | Specified in TD-13 and owning TD-11/12 amendments |
| Proposed scenarios 33–40 | Mapped to future `CONS-01` through `CONS-08`; not passing test results |
| Source/dependency/CI workflow scope | Unchanged; no app/native/database suite or new CI run claimed |
| User-owned wireframe and local personal rules | Wireframe untouched; personal working agreement remains ignored |

The documentation command checks entry points, not every semantic invariant.
Manual contract review and the two independent reviews supply the additional
design evidence; implementation tests must still prove the contracts.

## Open gates

- **Owner acceptance:** optional activity reflection adds sensitive Account data;
  targets mean participation, not prescribed exercise; measured clinical benefit
  remains an ambition. Accept these boundaries before C1–C5 implementation.
- **Professional/privacy review:** production movement and new expectation/
  activity-question wording, intended use, sensitive-data handling and licensing.
- **Benefit validation:** a separate consented protocol with defined population,
  intervention, outcomes, comparison, horizon, missing-data handling and harms.
  Do not collect real-user health or retention data under ordinary analytics.
- **Existing qualification:** E5/E6/A5 and device/archive/provider/legal/public
  gates remain open. This review closes none of them.

C0's document-review portion is complete. C0 as a whole is not complete until
owner acceptance. The next implementation slice, once accepted, is C1 Honest
Progress—not a UI rewrite or a change to the selection engine.
