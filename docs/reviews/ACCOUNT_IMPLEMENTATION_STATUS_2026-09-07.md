# Account implementation checkpoint — September 7, 2026

Status: **implementation complete locally; not yet qualified for merge or release**. Approved scope remains TD-10–12. Passing local tests does not close external credential, physical-device, privacy/legal, or production gates.

## Verified in this pass

- App: 50 Jest suites, 399 tests pass; TypeScript and ESLint pass. Added atomic local/outbox rollback, offline session/hydration, refresh/logout race, durable logout recovery, multi-device projection, reset retention, refresh/export cleanup, and two-phase deletion recovery regressions.
- PostgreSQL: eight migrations and five pgTAP files, 267 assertions pass locally, including private-table/client grants, command grants, duplicate receipts, reset epochs, installation/account mismatch, authoritative plan/lifecycle guards, complete one-time exports, expiry cleanup, and deletion revocation/recovery.
- Supabase CLI 2.117.0 configuration parses. Replaced deprecated local mail configuration. Removed a repeated constraint drop that would have broken migration 004.
- Added database migration/pgTAP verification to CI; the new CI job has not run on GitHub yet.

Regression fixes: refreshed JWT issuance no longer counts as recent authentication; social reauthentication checks identity in an isolated client before replacing the product session; logout targets only the current Auth session; signup carries its verification redirect; callback routes return to the single account-entry host; server approvals cannot be supplied by clients; invalid sync pagination is rejected before local writes; offline queues are batched; non-network sync failures remain failures; export cleanup exceptions stay typed; absent deletion credentials no longer falsely report completion.

Database mutation processing now locks the account before receipt/epoch handling. Check-in feed records precede their dependent safety events. This does not yet solve the separate pre-transaction plan-history race.

## Standards review

Compared account commits and working changes with baseline `0ee5861`, using AGENTS.md and CONTRIBUTING.md.

1. Resolved: optional-online writes silently reported success for every sync failure. Only durable offline-pending writes may now succeed offline; rejection/conflict/storage failure propagates.
2. Resolved: local-first product writes and outbox insertion now share one protected SQLite transaction. Real SQLite tests cover failed enqueue rollback/retry, stale epochs, and loss of protected-data access.
3. Resolved: export file-existence checks could throw outside the typed result boundary.
4. Heuristic, not a hard violation: `kineo-sqlite-sync-repository.ts` mixes account/outbox mechanics with extensive product projections and lifecycle reconstruction. Separate responsibilities only as needed to fix projection correctness; avoid a speculative rewrite.

## Spec review

Independent review against TD-10–12 identified four major open gaps:

1. **Server authority:** the server approves levels/metadata, but still accepts client-composed exercises, doses, decisions, and fingerprints. Share canonical versioned selection/composition code; enforce attention state and exact server composition under a coherent account-state version. A client checksum is not authorization.
2. Implemented; integration qualification remains: protected identity is atomically bound to the refresh credential. Cached access requires completed hydration, active account state, and current legal acceptance. Function requests use centrally serialized refresh; refresh/logout races and revoked credentials have regressions. Long-running native/Auth tests remain.
3. Implemented; integration qualification remains: two-phase deletion prepares a non-destructive job, saves recovery credentials, then commits. Relaunch checks recovery before Auth. PostgreSQL tests verify revocation before domain removal and recovery after Auth removal; server tests cover already-missing Auth identities. Native/local Auth failure injection remains.
4. **Logout/relogin:** the revoked installation identifier is reused, and explicit offline discard still requires online revocation. Implement durable logout recovery and new installation identity without bypassing revocation or silently losing pending work.

Resolved locally: server-authoritative composition/safety, routine lifecycle and feedback ownership, durable logout/relogin recovery, multi-device projections, reset retention, complete exports, and rejected-outbox quarantine. Real local API qualification passes password signup/login, server consent gating, canonical plan/tamper rejection, routine lifecycle, feedback-area enforcement, and deletion recovery.

## Additional qualification work

- Verify remote routine ownership, event ordering, local pending checkpoints, conflict resolution, epoch resets, and paginated projections with real SQLite and server commands—not only transport fakes. Local regression coverage now passes.
- Complete export contents, expiry cleanup, protected temporary files, and deletion session revocation/idempotency. Local database and app cleanup tests now pass.
- Qualify callback and recovery links, provider cancellation/revocation, legal-document access, abuse settings, and generic email responses with local Auth/mail plus configured provider credentials.
- Run native rebuild, simulator account flows, accessibility, network/log inspection, and load/concurrency tests. Physical-device and production credential/privacy review remain release gates.

## Local database environment

Colima 0.10.3 and Docker CLI 29.8.0 are installed. Dedicated VM: `kineo` (2 CPUs, 4 GiB RAM, 30 GiB data disk). Docker context: `colima-kineo`. Network: `kineo-local-tests`, host binding `127.0.0.1`. Only the database was started, not the complete Auth/mail/Edge stack. No cloud project was deployed or modified.

With Docker configured for that context/socket:

```sh
npx --yes supabase@2.117.0 db start --network-id kineo-local-tests
npx --yes supabase@2.117.0 test db --network-id kineo-local-tests
```

Use the same network flag for both commands. CLI-generated `.temp` files and environment files are ignored under `supabase/.gitignore`.

No account PR exists at this checkpoint. Do not merge this branch on local results alone.

The generated iOS project was regenerated and a Release simulator build succeeded. The clean simulator launch check rendered the expected first-use promise screen. Physical-device Keychain/protected-data behavior, configured Apple/Google credentials, provider abuse settings, production SMTP/DNS, privacy counsel, and App Review remain external release gates.
