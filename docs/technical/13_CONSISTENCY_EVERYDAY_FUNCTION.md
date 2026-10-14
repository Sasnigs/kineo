# TD-13: Consistency and Everyday Function

| Field | Value |
| --- | --- |
| Status | Accepted for internal implementation October 14, 2026; qualification gates remain open |
| Owns | Participation targets, re-entry, everyday-activity reflection, projection semantics, and reminder extension |
| Depends on | Product v0.7, UX, TD-02/03/05/07/08/10/11/12 |
| Baseline | `b03bc7363b3a84688b4c8476fb1f69a5636dd2d4` |
| Updated | October 13, 2026 |

## 1. Purpose and scope

Help an eligible adult make movement repeatable, return without catch-up pressure,
and observe their own experience over time. Keep the existing deterministic Plan
engine. This is not a chronic-pain treatment program, mobility measurement, or
proof that Kineo caused improvement. Neck/back scope and all release gates remain.

The owner accepted this amendment with “implement” on October 14, 2026.
TD-13 specifies the consistency delta; it does not
supersede safety, authentication, Plan authority, or privacy controls. After
acceptance, its specific target/reminder/projection rules supersede conflicting
legacy defaults in TD-02/05/07. TD-11/12 still own synchronization and erasure.

## 2. Decision checks

| Decision | User benefit | Failure risk | Required consequence |
| --- | --- | --- | --- |
| User-selected participation target | A manageable intention, not a fixed default | Target becomes an exercise prescription or a shame score | Optional, editable, never an input to selection; label participation separately |
| Scheduled generic reminders | Support remembering at chosen times | Nagging, duplicate alerts, or sensitive lock-screen content | Explicit days/time; local scheduling; permission and applied-state recovery |
| Return-after-gap entry | Make restarting easier | Old Check-in reuse, catch-up, or bypass of Attention | Preserve Today precedence; fresh Check-in; no automatic level change |
| Separate progress layers | Show what happened without inventing benefit | App engagement presented as mobility recovery | Distinct participation, recorded completion, and personal reflection |
| One everyday-activity goal | Connect use to something meaningful | New sensitive data or a misleading clinical score | Optional curated choice, protected account data, no score or causal inference |
| Reviewed expectations content | Reduce uncertainty about the experience | False reassurance or promised relief | Versioned reviewed copy; no fixed improvement timeline or push-through advice |

## 3. Architecture and interface

```text
Today / Progress / Profile
            |
    ConsistencyModule
     |       |        |
     |       |        +--> existing reminder adapter --> local OS schedule
     |       +--> existing protected history --> pure projections
     +--> existing SyncModule --> typed Edge commands --> private PostgreSQL

SelectionModule <--- existing Check-in/history inputs only
                    (no target, reflection, reminder, or gap input)
```

Core owns validated values, projections, and non-influence rules without platform
imports. One application module owns the new workflows through the existing
cache, SyncModule, and reminder interfaces; do not add another backend or analytics
service. Suggested interface operations: `loadSummary`, `setParticipationTarget`,
`selectEverydayActivity`, `saveActivityReflection`, and `setReminderSchedule`.
Selecting no activity explicitly removes the active goal; it is not a missing
field silently interpreted as deletion.

Expected failures use typed results: invalid input, unavailable account data,
online required, stale version, stale epoch, storage unavailable, and scheduling
failure. Map infrastructure errors once. Failed writes keep the committed state
and recoverable draft; no fabricated success or empty replacement history.

## 4. Participation and completion semantics

- **Participation Day:** unique captured local day with a completed Routine,
  an intentionally stopped Routine that actually started, or eligible Pause Today.
- Prepared-but-never-started, abandoned, safety-stopped, and unfinished Routines
  are displayed truthfully but do not increment this existing participation rule.
  Safety stopping receives no penalty or lost-progress message.
- **Recorded Routine Completion:** a Routine marked completed by the existing
  lifecycle. It is not observation of physical exercise; show skip/alternative
  details rather than inferring a therapeutic dose or movement quality.
- Opening the app, editing a target, answering a reflection, and receiving a
  notification do not create a Participation Day.
- Deduplicate by Account, stable record identity, and captured local day. Two-area
  Routines and repeated same-day Routines contribute only one Participation Day;
  recorded Routine completions remain a separate count.
- Preserve TD-02's captured event-day/time-zone grouping. Sync arrival and later
  travel never move past Participation Days. Label the existing Monday–Sunday
  week explicitly; inject clock/calendar in tests.
  A Routine uses its captured origin day, even if it finishes after midnight;
  Pause Today uses its captured event day. These are record-grouping keys, not
  claims about the calendar day on which every movement was performed.
- Active availability belongs in Plan options, not Progress as an achievement.
  Its prototype eligibility rules are unchanged and still require professional
  production review.

## 5. Participation target

Choose an optional weekly Participation Day target using TD-02's existing
one-through-seven bounds. This is a personal engagement intention, not recommended
exercise frequency. No target or notification preference changes a Plan.

- Offer setup after the first completed Routine or intentional stop of a started
  Routine; prepared-but-never-started termination is not first value. Never offer
  it before the first Check-in or as a completion gate. Skip is equivalent
  in prominence. Profile permits setup/edit/disable later.
- Retain legacy `weeklyGoalDays` only for compatibility. Its old default of three
  is not proof that a user chose a target. Migration marks it unconfirmed; hide
  the target denominator until explicitly confirmed. Never invent historical
  target achievement.
- The first explicit choice applies to the current local week; disclose that it
  was chosen during that week. Subsequent target changes apply next week, with
  current/next values shown. Disabling the goal hides target pressure immediately
  but does not erase source history.
- The existing versioned Profile aggregate owns confirmation and an independent
  `participation_target_enabled` flag. Immutable target decisions contain the
  numeric choice and effective week, not the immediate visibility toggle.
  Append replacement decisions; the latest committed decision for an effective
  week wins. Earlier decisions remain audit records, not competing targets.
  Materialize nothing on a read if it can be derived.
- Calendar-zone changes apply to future target decisions only. Count history
  using captured local-day keys; do not imply exact adherence to reminder days.

| Action | Persisted effect | Visible result |
| --- | --- | --- |
| First confirmation | Confirm/enable Profile; append current-week decision | Current target, labeled chosen this week |
| Edit a confirmed target | Append/replace next-week decision under Profile expected version | Current target unchanged; pending choice shown |
| Disable | Disable Profile immediately; retain current/pending choices | No denominator; reminders remain a separate preference |
| Re-enable | Enable Profile; retain existing choices | Previously applicable current target and pending choice return; no retroactive achievement claim |
| Cancel pending change | Append next-week decision equal to current choice | No pending difference; earlier audit decision remains |

Disable/re-enable is online validated like other target writes. Offline users
retain the last committed preference; optional UI can be dismissed without saving.
Past-week choices are not rewritten by later enablement or travel.
Targets provide current-week planning context only. Do not render historical
target-achievement scores or infer historical enablement from numeric decisions.
After re-enabling, label the current activation date; participation counts retain
their own meaning, not an assertion that an inactive target was achieved.

## 6. Everyday Activity Goal and weekly reflection

One optional active goal per Account, separate from Body Areas and Plan selection.
For the first prototype, use curated identifiers for an activity the user already
does: walking for daily tasks, sitting for usual tasks, or looking around during
daily tasks. These are reflection subjects, not instructions to attempt an activity.
Provide None/Skip; defer free text, timed performance tests, camera measurement,
and clinician goal assignment. Labels/questions require professional review
before external functional testing.

Offer one optional inline invitation per Account/calendar week in Progress,
never in the required daily Check-in. This is not an automatic modal. Ask:
“How difficult was [your activity] for you this week?” Prototype categorical
values: `littleDifficulty`, `someDifficulty`, `muchDifficulty`, `notAttempted`.
Skip creates no reflection. This is not a validated clinical instrument; no
numeric score, percentage recovery, or inferred pain reduction is displayed.

- First entry establishes a personal reference, not a normal population baseline.
- Show dated self-reports with their exact activity/version. Missing and
  not-attempted periods are not improvement or deterioration.
- Replacing the activity creates a new Goal identity and starts a separate series;
  retain/disclose the old series until Reset History or Delete Account.
- Removing the active goal stops prompts and archives its series; explain retained
  history. Re-selecting the same activity starts a new Goal rather than silently
  reconnecting an old series.
- A harder report never selects Gentle, enters Attention, changes Active eligibility,
  or starts a Routine. If the user wants a Plan, require the ordinary fresh
  Check-in and its existing safety rules. Do not turn this reflection into triage.
- Weekly invitation appears inside Progress, is dismissible for that period, and
  generates no additional notification. Today retains one primary action.
- Profile captures `reflection_calendar_zone` on the first Goal selection of
  the History Epoch, validates it against supported IANA zones on the server,
  and keeps it fixed until Reset History. Each Goal stores that same immutable
  `series_time_zone_id`; travel does not redefine “this week.” Display the zone
  when it differs from the device zone. Replacement Goals use the same calendar.
- Profile stores the dismissed week start under its expected version. A saved
  reflection or dismissal hides that period's invitation across hydrated
  Installations, including after Goal replacement. Stale offline devices may
  show the same inline invitation until sync; do not promise globally exactly-once
  presentation. It remains one logical invitation, not a new popup on every visit.
  Manual reflection entry/correction remains available even after dismissal.
- Dismissal suppresses locally and durably immediately, including offline. Queue
  only this explicit dismissal command for the same Account/epoch/period; retry
  idempotently, never clear local suppression on stale hydration, and ignore an
  obsolete-period dismissal rather than suppressing a later week. No answer is
  created. Reset clears the calendar/dismissal state; logout/deletion wipes it.

## 7. Proposed data and command delta

All records are private and Account-scoped under TD-11; Account identity comes
only from verified JWTs. Tables below are proposed logical contracts, not migrations.

| Record | Required shape and constraints |
| --- | --- |
| Existing Profile extension | Confirmed-at, target-enabled flag, reflection calendar zone, dismissed invitation week; existing optimistic aggregate version owns settings and target commands |
| `participation_target_versions` | Account, ID, History Epoch, numeric target, effective week start, zone, committed Profile version/server time; append-only replacement decisions, no retroactive edits |
| `everyday_activity_goals` | Account, Goal ID, current History Epoch, allow-listed activity ID and copy version, immutable series time-zone ID, active/archived state, optimistic version; at most one active |
| `activity_reflections` | Account, ID, Goal ID, History Epoch, week-start/zone snapshot, categorical value, optimistic version, client recorded/server committed timestamps; one logical reflection per Goal/period |
| Reminder settings extension | Account-owned selected weekdays and local time plus version; system permission and actual schedules remain Installation-local |
| Protected drafts | Account, epoch, Goal/target version and period context; bounded to the current editing flow; wiped by logout/reset/deletion |
| Installation-local suppression | Account/epoch-scoped reminder opt-out and invitation dismissal with stable pending Mutation ID/context; durable protected storage, included in lifecycle wipe |

Goal/reflection ownership and epoch relationships use composite foreign keys.
The unique reflection key includes Account, Goal ID, period start and period zone.
Reflection corrections update only with `expectedVersion`; a retry uses the same
Mutation ID. Conflicting edits return authoritative state for explicit review,
not last-writer-wins. Keep a Goal's calendar zone fixed for its series so two
Installations cannot create duplicate periods by supplying different zones.

Proposed typed commands: set/enable/disable target, cancel pending target change,
select/remove Goal, save/correct reflection, dismiss weekly invitation, and set
reminder schedule. All require current epoch and expected aggregate
version; a duplicate Mutation ID returns its prior receipt. Extend bootstrap,
change-feed coverage, snapshot paging, and protected SQLite migrations together.
Do not write arbitrary rows or fork the selection engine.

Target, Goal, reflection, and reminder enable/change writes require server
validation. Local reminder opt-out and invitation dismissal are the narrowly
defined suppression exceptions below; they create no health answer or Plan.
Offline users can read cached views,
continue the active Routine, and retain a protected draft. “Saved” requires the
server commit and cache application to succeed. An offline/stale draft is not
submitted automatically on a different Account, Goal, epoch, or period; reload
and ask the user to confirm or discard it. Unavailable optional features never
block the ordinary Today flow.
If the server committed but cache application failed, retain the receipt/Mutation
ID and show “Sync needed,” not a rejected input or success with stale views.
Replay the receipt and hydrate on Retry; never submit a new duplicate mutation.

## 8. Re-entry and expectations

Use the Today precedence and Plan-restoration guards owned by TD-05 section 5.1.
Return support is a secondary action
within ordinary Today, not a new mandatory gate or a competing route.

For a simple initial implementation, offer “Make returning easier” without
asserting the user missed prescribed sessions. A generic welcome-back message
may use known committed prior participation, but incomplete hydration, reset,
or unknown history must not produce a “you missed” claim. No clinical gap-duration
threshold, automatic deconditioning inference, catch-up, or level escalation.

Optional barrier choices stay transient and are not stored or sent as telemetry:

| Choice | Route |
| --- | --- |
| Not enough time | Ordinary Check-in; offer authored Quick after level selection |
| Unsure about the instructions | Approved explanation/instructions; ordinary Check-in before any new Plan |
| Movement felt difficult | Existing safety information and ordinary Check-in; no automatic clearance or reassurance |
| Not noticing change | Reviewed expectations content; optional Progress review, no promise or invented improvement |
| Prefer not to answer | Ordinary Today, unchanged |

Keep Better/Same/Worse feedback optional and neutral. Completion is recorded
before feedback; Same is not a failure. Reviewed expectations content must not
say worsening is normal, advise pushing through, promise a result by a date, or
claim that dedication guarantees benefit. Store its copy/version in the shipped
content package, not model-generated or remote-configured text.

## 9. Reminder extension

Keep reminders optional. Offer explicit weekday selection and local time instead
of only the two current presets. Selection is user scheduling, not inferred ideal
timing. Reminders are independent of the flexible participation target; a reminder
day is not a prescription or a missed-session obligation.

Use at most one owned weekly calendar request per selected weekday, with stable
non-sensitive weekday identifiers; the bound is the named calendar week size.
Remove the legacy daily request when applying the new schedule. This proposed
rule replaces TD-07's exactly-one-daily rule only after amendment acceptance.

Enabling/changing a schedule persists desired settings through the server first;
report desired and locally
applied states separately. Reconcile on foreground/permission/time-zone changes.
On partial platform failure, cancel the partial new set and restore the previous
verified schedule or verify no owned request remains; expose Retry and the safe
applied state. If cleanup/verification also fails, show schedule status unknown
and Retry, not a fabricated verified-empty state. Never claim all reminders are
active after partial success.

Disabling immediately persists an Installation-local suppression marker and
cancels all owned requests, even offline. Report “Off on this device; Account
change pending” until the server accepts the explicit disable command. Other
offline Installations cannot be guaranteed canceled until they hydrate. The local
marker outranks stale server settings on launch/foreground/reconciliation; only
an explicit online re-enable on this Installation clears it after successful
server commit and local application. Retry a version conflict by refreshing and
re-confirming the account-wide change; keep local alerts suppressed meanwhile.
Cancellation/protected-storage failure shows a typed error and unknown applied
state; still attempt cancellation if storing suppression fails, and do not claim
durable opt-out until both marker persistence and cancellation are verified.
Do not claim alerts are off without verification. Logout/deletion clears
them under existing verified cleanup rules. Reset History
retains the current preference, not sensitive reflection notifications.

Keep static generic copy and Today-only metadata. No Goal, pain, missed day,
reflection, Routine, or Account detail on the lock screen. DST follows documented
platform calendar matching, with no duplicate or catch-up alert; qualify spring/
autumn transitions on the chosen Expo/iOS adapter before claiming exact behavior.

## 10. Privacy lifecycle delta

- Explain that Goal and reflection values sync privately; do not label them
  device-only or reuse general analytics consent for research.
- Reset History deletes all Goals/reflections, historical target decisions and
  projections, and their drafts/outbox items. Retain only the current/next target
  preference needed going forward, reminders, and TD-12's minimum Attention state;
  rebase retained target settings into the new epoch without old usage history.
  Clear reflection calendar/invitation state. Retain local reminder suppression
  so reset cannot reactivate alerts; rebase only an explicit pending opt-out to
  the new epoch, never a stale reflection or target mutation.
- Export includes these records and versions with descriptive categories, not
  sensitive filenames. Archived goals remain included until erased.
  Include retained cloud invitation/target settings; document Installation-local
  suppression metadata separately as local preferences, not health reflections.
- Logout wipes all protected cache/drafts and owned notifications. Pending work
  follows the existing wait-or-explicit-discard choice, never silent loss.
- Delete Account covers all new tables, local values, exports and jobs; resume
  interrupted deletion and reject stale Installations/epochs as TD-12 requires.
- Reminder permission/applied-state metadata stays local. Staff and analytics
  receive no routine access to the new personal history.

## 11. Validation and implementation handoff

Ship the C0–C5 slices in the milestone document. C0 is accepted; C1 is implemented
locally with qualification recorded in the dated C1 report. C2–C5 are pending.
Use synthetic fixtures until applicable professional/privacy gates
are met. TD-08 acceptance extension specifies the automated cases.

Product hypotheses are separate:

1. The revised flow is understandable and easier to return to.
2. It supports sustained participation and recorded Routine completion.
3. A professionally designed intervention improves function/pain for a defined
   population. Hypotheses 1/2 do not establish hypothesis 3.

Start with isolated non-functional usability mockups and voluntary interviews.
No functional external pain-user test with placeholder movements or unreviewed
safety/expectation wording. A later consented study requires a separately approved
protocol: population, intervention/content, appropriate outcomes and time horizon,
comparison/baseline, sample justification, consent/withdrawal, data access and
retention, harms/referrals, and applicable research/legal review. Do not fabricate
clinical thresholds, recruit users, add tracking, or use health data under this task.

Keep per-person retention/functional data out of generic telemetry. If a study
needs those values, explicit study consent and its approved data flow govern it.
Predefine measures/decision criteria before the study, not after seeing results.
