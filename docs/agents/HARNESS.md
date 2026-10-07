# Agent delivery harness

Status: foundation implementation. This is tooling, not product or release approval.

## Contract

One coordinator delivers one approved task on a feature branch. Each task records a goal, exact editable paths, acceptance criteria, check profiles, base commit, and limits. Read the owning product/technical contracts before acting. A task file records scope; it cannot grant itself new authority.

```text
Approved task → scoped implementation → targeted checks → independent review
                      ↑                         │                │
                      └──────── bounded fixes ──┴────────────────┘
                                     ↓
                         PR → all CI green → merge → sync
```

The coordinator uses `Scripts/agent-task.mjs`. This dependency-free controller can invoke `codex exec`, but does not run a queue, automatically interpret review prose, commit, or merge. The delivery skill owns the review/PR loop. Keep that separation until real use demonstrates a need for more automation.

## Commands

Use Node from `apps/mobile/.nvmrc`. Start from current main on a dedicated feature branch or worktree. Preserve unrelated user work in the original checkout.

```sh
node Scripts/agent-task.mjs start docs/agent-tasks/account-status.json
node Scripts/agent-task.mjs agent docs/agent-tasks/account-status.json implement
node Scripts/agent-task.mjs check docs/agent-tasks/account-status.json
node Scripts/agent-task.mjs status docs/agent-tasks/account-status.json
node Scripts/agent-check.mjs tooling
```

`agent ... review` invokes a read-only Codex pass. Independent standards/spec review through the installed code-review skill remains required. Do not treat an agent's final prose or a successful process exit as acceptance evidence.

Resume by running the same command with the same task. Changes to the task contract require a new task ID. Checkpoints, CLI output, and prompts stay in ignored `.agent-runs/`. An exclusive lock prevents concurrent launches. After a killed coordinator, inspect processes and checkpoint before manually removing its `run.lock`; never automatically clear a possibly active lock.

## Enforcement and evidence

- Reject main, invalid task fields, non-ancestor base commits, unsafe paths, and changes outside the exact scope. Scope is checked before/after actions, including untracked files and both sides of renames.
- Pin the task hash and branch in the checkpoint. Fingerprint HEAD and scoped file contents. Modified code invalidates prior check evidence.
- Persist the attempt before invoking an agent. Cap agent turns and total command time. Time is reserved before launch, so an interrupted coordinator cannot reset its allowance. Limits are conservative, not hard token quotas.
- Commands use argument arrays, not shell interpolation. Terminate the command process group on timeout. Failure stays failure. Check output is visible; agent traces remain local.
- Scope enforcement detects drift; it is not an OS security boundary. Codex uses workspace-write for implementation and read-only for review. Use isolated worktrees for concurrent tasks. Do not grant sandbox bypass flags.
- Every acceptance criterion needs a dated result in `docs/reviews/`. Include base/final commits, exact checks, review findings/fixes, and CI links. Status is never “release ready” merely because CI passed.
- UI changes also need existing Maestro journeys plus simulator screenshots, including large text and dark mode as relevant. Use fixture accounts only. Physical-device, content, provider, legal, and public-release gates stay separate.
- No private user data, credentials, or raw account logs in versioned evidence. Local traces can contain prompts or diagnostics: inspect before sharing. Personal rules and skills stay local.

## Check profiles

| Profile | Runs | Use |
| --- | --- | --- |
| docs | Task/agent-map integrity | Documentation only |
| tooling | Docs checks and harness integration tests | Harness changes |
| mobile | TypeScript, ESLint, Jest | Product behavior |
| database | Existing account API integration check | Already-running local Supabase stack |

Profiles are not substitutes for CI. Dependencies must already be installed. Database setup and native/UI qualification use the existing CI/scripts; no hidden service boot or destructive simulator reset. Native builds run once per meaningful native change, not per documentation edit.

## Stop rules

Stop on missing authorization, scope drift, unavailable required services, failed/unresolved review, exhausted limits, or a release gate. Preserve the checkpoint and report the smallest next action. Do not skip checks, expand scope, force-push, or merge pending/failed CI to keep moving.

Publish a concise draft PR after local checks and review. The standing owner authorization permits merge only after **all** expected CI jobs succeed and the reviewed head is unchanged. Preserve logical commits, then sync main with `--ff-only`. Never auto-submit to the App Store or alter production credentials.

A failed CI run blocks merge, not authorized diagnosis. Continue a bounded repair/test/CI loop when the fix is in scope. Do not end delivery just because a fail-fast shell watcher exited. A watcher is not a recurring agent wakeup: register a supported scheduler before claiming autonomous follow-ups; otherwise remain in the active loop until success or a genuine blocker. Do not rerun unchanged failing checks or incur new builds when a required security gate is already known to fail.

## Foundation acceptance

1. Repo entry points and current delivery state are discoverable without chat history.
2. A task is bounded by exact scope, runtime, and attempts; durable evidence cannot silently become stale or successful after failure.
3. One verification command selects existing checks without new dependencies.
4. Integration tests prove scope, failure, interruption, concurrent-lock, stale-evidence, and exhaustion behavior.
5. A real docs-only pilot corrects account status using merged PR evidence, preserves external gates, and receives independent review and CI before merge.

Derived from [OpenAI harness engineering](https://openai.com/index/harness-engineering/) and [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive/). The small map, durable plans, observable checks, and bounded repair loop are adopted; weaker merge gates are not.
