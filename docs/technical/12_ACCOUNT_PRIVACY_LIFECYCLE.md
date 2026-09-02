# TD-12: Account Privacy Lifecycle

| Field | Value |
| --- | --- |
| Status | Approved implementation contract |
| Owns | Reset History, personal-data export, Delete Account, interrupted-workflow recovery |
| Depends on | TD-10, TD-11 |
| Last updated | September 2, 2026 |

## Architecture

```mermaid
flowchart LR
    UI[Privacy screens] --> Privacy[AccountPrivacyModule]
    Privacy --> Reauth[AuthModule reauthentication]
    Privacy --> Functions[Authenticated Edge Functions]
    Functions --> Jobs[(Export and deletion jobs)]
    Jobs --> Data[(Private account data)]
    Functions --> Local[Local wipe coordinator]
```

## Interface

```ts
interface AccountPrivacyModule {
  resetHistory(grant: ReauthenticationGrant): Promise<PrivacyResult<void>>;
  requestExport(grant: ReauthenticationGrant): Promise<PrivacyResult<ExportStatus>>;
  deleteAccount(grant: ReauthenticationGrant): Promise<PrivacyResult<DeletionStatus>>;
  resumeDeletion(): Promise<PrivacyResult<DeletionStatus>>;
}
```

## Rules

- Reset History is Account-wide. It increments `history_epoch`, deletes historical wellness records, and retains account identity, legal acceptance, preferences, reminders, and only the minimum currently active Attention Required state.
- Export requires recent reauthentication. `request-export` creates a structured JSON archive in private storage. Download authorization is one-time, short-lived, and bound to the requesting Account. Filenames and notifications contain no wellness detail.
- Delete Account requires recent reauthentication and explicit irreversible confirmation.
- `delete-account` first marks the Account deleting, revokes Installations and sessions, then removes product data and finally the Auth identity. `deletion-status` lets the app safely resume after interruption.
- A deleting Account rejects every product command. A stale Installation cannot authenticate or restore data.
- Local SQLite is wiped only after the server accepts deletion, or after status confirms that deletion is complete. A pending local deletion marker resumes cleanup after relaunch.
- Staff have no routine access path to wellness history. Emergency access, if ever introduced, requires a separate audited design.

## Verification

- Reset scope and old-epoch rejection across two Installations.
- Export reauthentication, authorization, structured contents, single use, expiry, and cleanup.
- Deletion interruption at every phase, idempotent resume, token revocation, stale-device rejection, and verified local wipe.
- Generic errors and notifications reveal no account existence or wellness detail.
