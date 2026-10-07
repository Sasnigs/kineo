# PR 30 CI recovery — October 7, 2026

Status: compatibility repaired locally; required security gate remains blocked. No merge, audit waiver, SDK-major upgrade, or recurring scheduler was enabled.

## Reproduction and repair

- Published base: `9fff766`. [CI run](https://github.com/Sasnigs/kineo/actions/runs/37662604093) passed harness/database jobs and failed Expo's dependency validation before native build.
- Online `npm run dependencies:check` reproduced nine SDK 57 patch mismatches in under a second. Offline Expo used local bundled metadata and incorrectly appeared green for this CI comparison; it is not online verification evidence.
- Updated only Expo, constants, linking, notifications, router, sharing, SQLite, video, and modules-core to the compatible SDK 57 patch ranges. No React Native, Node, provider, or product/UI change.
- Installed with scripts disabled. `npm audit fix --ignore-scripts` applied only compatible lockfile updates; no `--force` downgrade/upgrade was used.

## Verified outcomes and blocker

- Online compatibility check passes after the SDK patch update.
- TypeScript, lint, and all 51 app suites/406 tests pass. Harness: 13 regression tests pass. Project boundaries and diff whitespace checks pass.
- Initial audit: 70 reported package findings (17 moderate, 52 high, one critical). Compatible updates remove the critical shell-quote advisory. The intermediate JSON audit reported 67 (17 moderate, 50 high); the final required `npm run audit` reported 68 (17 moderate, 51 high) and exited nonzero. Counts include propagated dependent-package findings and can change with the online advisory/resolution metadata; they are not separate root vulnerabilities.
- Remaining high-severity roots include [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Registry checks show latest releases 3.0.3 and 1.4.0; the advisories list no patched version. Other moderate roots remain. The audit's proposed Expo 44/Jest-major changes are not safe patch fixes.
- The required high-severity audit gate therefore still fails. No new full CI build is useful against the same known blocker. Keep PR 30 unmerged; investigate upstream replacements/remediation separately. Any security exception or framework migration requires an explicit reviewed decision, not automatic acceptance to obtain green CI.

## Monitoring correction

The previous shell watcher polled every 30 seconds but exited on failure. The coordinator then ended delivery without scheduling repair; this was a workflow defect, not a polling-frequency issue. Local owner rules and the delivery skill now require failures to transition into bounded repair without another owner prompt. This session exposes no recurring-task creation tool; an actual 20-minute scheduled task has not been registered and must not be claimed as active.

## Subsequent coordinator evidence

- Published head `6430044` triggered [CI run 37674502873](https://github.com/Sasnigs/kineo/actions/runs/37674502873). The harness and account-database jobs passed. Expo compatibility passed, then the required audit failed with 67 findings (17 moderate, 50 high). The count differs from the local result because advisory metadata can change; the blocking roots did not change.
- A fresh online local audit on October 7, 2026 failed with 68 findings (17 moderate, 51 high). Registry queries still reported `braces` 3.0.3 and `node-forge` 1.4.0 as latest; the latest `micromatch` and `@expo/code-signing-certificates` releases still depend on those versions. No compatible patched release was available.
- Independent standards review found one separate harness boundary defect: missing documentation paths escaped as raw `ENOENT` errors. Commit `b159c38` maps them to typed `DOCS_FAILED` failures and adds focused regressions. `node Scripts/agent-check.mjs tooling` then passed all 18 tests; `git diff --check` passed.
- Independent spec review found no product, UI, provider, production-service, credential, audit-threshold, framework-major, or Expo-downgrade scope creep. The upstream high-severity findings remain a Critical merge blocker; no exception was made.
