# PR 30 dependency repair — October 12, 2026

Scope: repair CI on `feat/agent-harness`. Fixed review baseline:
`427ad97362236464c78642c8e311e7762865edbc`. No product, provider, data,
production-service, credential, or release-policy change.

Reviewed implementation: `2a9e3e10807a1dc42604642c98a6c551eb621a21`.

## Decision and dependency lineage

The owner approved temporary pinned patches after isolated qualification and
independent review. Official latest releases still report `braces@3.0.3` and
`node-forge@1.4.0`; neither fixes the blocking advisories. The high-severity audit
threshold remains unchanged. Scanner silence under a derivative package name
or prerelease version does not establish remediation.

- Braces: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
  Use `npm:@dieub/braces-depth-guard@3.0.3-pn.3`, MIT. Its reviewed changes bound
  parser depth, every recursive public AST traversal, caller-supplied depth
  options, and parent cycles; `index.js` is unchanged.
- Forge: [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
  Use [upstream PR 1157](https://github.com/digitalbazaar/forge/pull/1157) at
  `683ab3344899cc08a581e4d5675a33e87aff7b04`, BSD-3-Clause license option.
  Only runtime delta is in `lib/rsa.js`: reject extra AlgorithmIdentifier
  children and nonempty NULL parameters. This is unreleased upstream work,
  not an officially released fix. The earlier count-only patch was rejected
  when independent reviewers found the NULL-content gap.

Both overrides are exact; `apps/mobile/package-lock.json` pins resolved
artifacts and SHA-512 integrity. No floating Git branch or tarball is used.

| Artifact | Exact identity | SHA-512 integrity |
| --- | --- | --- |
| Braces | Registry `3.0.3-pn.3`; source `d18b560e57b7fcdab654ede063898ef11d89e334` | `sha512-QY+Uq4s42STyIMPoRkBuUZfYyvz0uZuwuUburLwMx5N+lWqnHHaBxcKPtgKVKjTyFnS1q4ivKu9Wxi4VG7FE9Q==` |
| Forge | GitHub archive `683ab3344899cc08a581e4d5675a33e87aff7b04` | `sha512-g/EvxFte1XuZD2rLZevZ3raECoWnsHZTLQJ9rAgOVIKyAph6F9JuYKMqcaNH57bRV5E8MS6wqL59eynOa/G2CA==` |

Braces registry signatures and GitHub OIDC provenance verified in qualification.
This establishes origin, not upstream endorsement or security clearance. The
verified package README calls pn.3 unpublished despite the existing registry
artifact; preserve and disclose this metadata discrepancy. Forge's GitHub
archive is not covered by npm registry signatures.

Expo's live compatibility service also raised seven SDK 57 patch requirements:
Expo, Crypto, Router, Sharing, Splash Screen, Modules Core, and Jest Expo. Align
these using `expo install --fix`, without a framework major change or forced
audit fix.

## Regression evidence

`npm run security:check` exercises dependencies resolved from the actual
Micromatch and both Expo Forge consumers. Original installed dependencies fail
six of ten cases. Patched dependencies pass all ten after a clean `npm ci`,
without any qualification loader. The SDK patch update moved CLI beneath Expo;
review caught the test's root-hoisting assumption. Tests now resolve CLI through
Expo and certificates through CLI, so they follow the real dependency chain.

Cases cover ordinary expansion/matching, deep braces/parentheses, raised depth
limits, direct recursive AST entry points and depth boundaries, valid/tampered
RSA signatures, extra AlgorithmIdentifier children, nonempty NULL parameters,
and Expo certificate/CSR serialization and verification. Malformed-signature
fixtures use a fixture private key and Node/OpenSSL as an independent rejection
oracle. They demonstrate malformed-encoding acceptance, not keyless forgery.

The unchanged audit gate passes with 42 moderate findings and no high/critical
findings at this checkpoint. These are propagated package findings from three
remaining roots: decode-uri-component, sprintf-js, and uuid. Counts can change
with advisory metadata. Their proposed forced remediations are incompatible;
this repair does not claim an advisory-free or release-ready dependency tree.

Local checks against the final patch-aligned installed graph:

| Check | Result |
| --- | --- |
| Clean `npm ci --no-fund` | Passed |
| `npm run security:check` | 10 passed |
| `node Scripts/agent-check.mjs mobile` | TypeScript and lint passed; 51 suites / 406 tests passed |
| `node Scripts/agent-check.mjs tooling` | Documentation checks and 23 harness tests passed |
| `Scripts/verify-project-boundaries.sh` | Passed |
| `npm run dependencies:check` | Live compatibility check passed |
| `npm run audit` | Unchanged high-severity threshold passed; 42 moderate findings |
| `expo export --platform ios` | Internal-test bundle passed with local dotenv disabled |
| `npm run account:bundle` | Shared account domain build passed |
| `git diff --check` | Passed |

Independent Standards: no remaining standards or smell findings. Independent
Spec: no remaining implementation or scope findings. Both reviewers independently
reran the actual installed-tree security gate, confirmed pinned artifacts, and
closed the CLI-hoisting finding. These reviews qualify the implementation commit
above; the evidence-only follow-up does not change executable code.

## Maintenance and remaining gates

Kineo repository maintainers own both temporary overrides. Replace them when
official upstream patched releases become available; retain attack regressions
and compatibility checks. Re-review before public release. Do not silently
remove original advisory lineage or rely solely on npm's package matching.

Full CI on the final published head remains required before merge. Record its
exact head, run link, and final outcome in PR 30's delivery record; a pending or
failed run cannot be called successful. Existing physical-device, signed-archive, provider,
content/licensing, safety, legal/privacy, and public-release gates stay open.
