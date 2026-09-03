import type { AccountState, LegalAcceptance } from '../../core/account/account-domain';
import {
  createPendingMutation,
  type MutationDisposition,
  type PendingMutation,
  type SyncChange,
  type SyncCommand,
  type SyncResponse,
} from '../../core/account/sync-contract';
import type {
  BootstrapPage,
  SyncLocalRepository,
  SyncOutbox,
  SyncResult,
} from '../../core/account/sync-module';
import type {
  SqliteDatabase,
  SqliteExecutor,
} from '../../core/persistence/persistence-contract';

const singletonAccountStateId = 1;
const initialAttemptCount = 0;

type AccountRow = Readonly<{
  account_id: string;
  installation_id: string;
  account_status: AccountState['status'];
  history_epoch: number;
  sync_cursor: string | null;
}>;

type LegalRow = Readonly<{
  document_kind: LegalAcceptance['documentKind'];
  document_version: string;
  locale: string;
  accepted_at_ms: number;
}>;

type OutboxRow = Readonly<{
  mutation_id: string;
  account_id: string;
  installation_id: string;
  history_epoch: number;
  created_at_ms: number;
  command_kind: SyncCommand['kind'];
  payload_json: string;
}>;

type ExistingMutationRow = Readonly<{
  command_kind: string;
  payload_json: string;
}>;

type SynchronizedEntityRow = Readonly<{ payload_json: string | null }>;

export class KineoSqliteSyncRepository
implements SyncLocalRepository, SyncOutbox {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly accountId: string,
    private readonly installationId: string,
    private readonly afterWrite: () => Promise<SyncResult<void>> = async () => ({
      ok: true,
      value: undefined,
    }),
  ) {}

  async initialize(updatedAtMilliseconds: number): Promise<SyncResult<void>> {
    if (!Number.isSafeInteger(updatedAtMilliseconds) || updatedAtMilliseconds <= 0) {
      return localFailure();
    }
    try {
      const existing = await this.accountRow(this.database);
      if (
        existing !== undefined &&
        (existing.account_id !== this.accountId ||
          existing.installation_id !== this.installationId)
      ) {
        return localFailure();
      }
      if (existing === undefined) {
        await this.database.runAsync(
          `INSERT INTO local_account_state(
            singleton_id, account_id, installation_id, account_status,
            history_epoch, updated_at_ms
          ) VALUES (?, ?, ?, 'active', 1, ?)`,
          [
            singletonAccountStateId,
            this.accountId,
            this.installationId,
            updatedAtMilliseconds,
          ],
        );
      }
      return this.afterWrite();
    } catch {
      return localFailure();
    }
  }

  async loadAccount(): Promise<SyncResult<AccountState | undefined>> {
    try {
      const row = await this.accountRow(this.database);
      if (row === undefined) return { ok: true, value: undefined };
      const legalRows = await this.database.getAllAsync<LegalRow>(
        `SELECT document_kind, document_version, locale, accepted_at_ms
         FROM local_legal_acceptances
         WHERE account_id = ?
         ORDER BY document_kind, document_version`,
        [this.accountId],
      );
      return {
        ok: true,
        value: {
          accountId: row.account_id,
          status: row.account_status,
          historyEpoch: row.history_epoch,
          legalAcceptances: legalRows.map((legal) => ({
            documentKind: legal.document_kind,
            documentVersion: legal.document_version,
            locale: legal.locale,
            acceptedAtMilliseconds: legal.accepted_at_ms,
          })),
        },
      };
    } catch {
      return localFailure();
    }
  }

  async loadCursor(): Promise<SyncResult<string | undefined>> {
    try {
      const row = await this.accountRow(this.database);
      if (row === undefined) return localFailure();
      return { ok: true, value: row.sync_cursor ?? undefined };
    } catch {
      return localFailure();
    }
  }

  applyBootstrapPage(page: BootstrapPage): Promise<SyncResult<void>> {
    return this.applyPage(
      page.account,
      page.changes,
      page.nextCursor,
      [],
      [],
    );
  }

  applySyncPage(
    response: SyncResponse,
    sentMutations: readonly PendingMutation[],
  ): Promise<SyncResult<void>> {
    return this.applyPage(
      {
        accountId: this.accountId,
        status: response.accountStatus,
        historyEpoch: response.historyEpoch,
        legalAcceptances: [],
      },
      response.changes,
      response.nextCursor,
      response.dispositions,
      sentMutations,
      false,
    );
  }

  async enqueue(mutation: PendingMutation): Promise<SyncResult<void>> {
    const validated = createPendingMutation(mutation);
    if (
      !validated.ok ||
      mutation.accountId !== this.accountId ||
      mutation.installationId !== this.installationId
    ) {
      return localFailure();
    }
    const payload = JSON.stringify(mutation.command);
    try {
      const existing = await this.database.getFirstAsync<ExistingMutationRow>(
        `SELECT command_kind, payload_json FROM sync_outbox
         WHERE mutation_id = ?`,
        [mutation.mutationId],
      );
      if (existing !== null) {
        return existing.command_kind === mutation.command.kind &&
          existing.payload_json === payload
          ? { ok: true, value: undefined }
          : localFailure();
      }
      await this.database.runAsync(
        `INSERT INTO sync_outbox(
          mutation_id, account_id, installation_id, history_epoch,
          command_kind, payload_json, created_at_ms, attempt_count,
          next_attempt_at_ms, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          mutation.mutationId,
          mutation.accountId,
          mutation.installationId,
          mutation.historyEpoch,
          mutation.command.kind,
          payload,
          mutation.createdAtMilliseconds,
          initialAttemptCount,
          mutation.createdAtMilliseconds,
        ],
      );
      return this.afterWrite();
    } catch {
      return localFailure();
    }
  }

  async pendingMutations(): Promise<SyncResult<readonly PendingMutation[]>> {
    try {
      const rows = await this.database.getAllAsync<OutboxRow>(
        `SELECT mutation_id, account_id, installation_id, history_epoch,
                created_at_ms, command_kind, payload_json
         FROM sync_outbox
         WHERE account_id = ? AND installation_id = ? AND state = 'pending'
         ORDER BY created_at_ms, mutation_id`,
        [this.accountId, this.installationId],
      );
      const mutations: PendingMutation[] = [];
      for (const row of rows) {
        const command = parseCommand(row.payload_json, row.command_kind);
        if (command === undefined) return localFailure();
        const mutation = createPendingMutation({
          mutationId: row.mutation_id,
          accountId: row.account_id,
          installationId: row.installation_id,
          historyEpoch: row.history_epoch,
          createdAtMilliseconds: row.created_at_ms,
          command,
        });
        if (!mutation.ok) return localFailure();
        mutations.push(mutation.value);
      }
      return { ok: true, value: mutations };
    } catch {
      return localFailure();
    }
  }

  async discardPendingMutations(): Promise<SyncResult<void>> {
    try {
      await this.database.runAsync(
        `DELETE FROM sync_outbox
         WHERE account_id = ? AND installation_id = ? AND state = 'pending'`,
        [this.accountId, this.installationId],
      );
      return this.afterWrite();
    } catch {
      return localFailure();
    }
  }

  async resetForHistoryEpoch(historyEpoch: number): Promise<SyncResult<void>> {
    if (!Number.isSafeInteger(historyEpoch) || historyEpoch <= 0) {
      return localFailure();
    }
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        await deleteHistory(transaction);
        await transaction.runAsync(
          'DELETE FROM synchronized_entities WHERE account_id = ?',
          [this.accountId],
        );
        await transaction.runAsync(
          'DELETE FROM sync_outbox WHERE account_id = ?',
          [this.accountId],
        );
        await transaction.runAsync(
          `UPDATE local_account_state
           SET history_epoch = ?, sync_cursor = null, updated_at_ms = ?
           WHERE account_id = ? AND installation_id = ?`,
          [historyEpoch, Date.now(), this.accountId, this.installationId],
        );
      });
      return this.afterWrite();
    } catch {
      return localFailure();
    }
  }

  async pendingMutationCount(): Promise<SyncResult<number>> {
    try {
      const row = await this.database.getFirstAsync<{ mutation_count: number }>(
        `SELECT count(*) AS mutation_count FROM sync_outbox
         WHERE account_id = ? AND installation_id = ? AND state = 'pending'`,
        [this.accountId, this.installationId],
      );
      return { ok: true, value: row?.mutation_count ?? 0 };
    } catch {
      return localFailure();
    }
  }

  async loadSynchronizedEntity(
    entityKind: string,
    entityId: string,
  ): Promise<SyncResult<unknown | undefined>> {
    if (entityKind.length === 0 || entityId.length === 0) {
      return localFailure();
    }
    try {
      const row = await this.database.getFirstAsync<SynchronizedEntityRow>(
        `SELECT payload_json FROM synchronized_entities
         WHERE account_id = ? AND entity_kind = ? AND entity_id = ?`,
        [this.accountId, entityKind, entityId],
      );
      if (row === null || row.payload_json === null) {
        return { ok: true, value: undefined };
      }
      return { ok: true, value: JSON.parse(row.payload_json) };
    } catch {
      return localFailure();
    }
  }

  private async applyPage(
    account: AccountState,
    changes: readonly SyncChange[],
    cursor: string | undefined,
    dispositions: readonly MutationDisposition[],
    sentMutations: readonly PendingMutation[],
    replaceLegal = true,
  ): Promise<SyncResult<void>> {
    if (account.accountId !== this.accountId) return localFailure();
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const row = await this.accountRow(transaction);
        if (
          row === undefined ||
          row.account_id !== this.accountId ||
          row.installation_id !== this.installationId
        ) {
          throw new Error('Local account binding does not match.');
        }
        if (replaceLegal) {
          await transaction.runAsync(
            'DELETE FROM local_legal_acceptances WHERE account_id = ?',
            [this.accountId],
          );
          for (const acceptance of account.legalAcceptances) {
            await transaction.runAsync(
              `INSERT INTO local_legal_acceptances(
                account_id, document_kind, document_version, locale, accepted_at_ms
              ) VALUES (?, ?, ?, ?, ?)`,
              [
                this.accountId,
                acceptance.documentKind,
                acceptance.documentVersion,
                acceptance.locale,
                acceptance.acceptedAtMilliseconds,
              ],
            );
          }
        }
        for (const change of changes) {
          await applyChange(transaction, this.accountId, change);
        }
        await applyDispositions(transaction, dispositions, sentMutations);
        await transaction.runAsync(
          `UPDATE local_account_state
           SET account_status = ?, history_epoch = ?, sync_cursor = ?,
               last_synced_at_ms = ?, updated_at_ms = ?
           WHERE singleton_id = ? AND account_id = ? AND installation_id = ?`,
          [
            account.status,
            account.historyEpoch,
            cursor ?? row.sync_cursor,
            Date.now(),
            Date.now(),
            singletonAccountStateId,
            this.accountId,
            this.installationId,
          ],
        );
      });
      return this.afterWrite();
    } catch {
      return localFailure();
    }
  }

  private async accountRow(
    executor: SqliteExecutor,
  ): Promise<AccountRow | undefined> {
    const row = await executor.getFirstAsync<AccountRow>(
      `SELECT account_id, installation_id, account_status, history_epoch, sync_cursor
       FROM local_account_state WHERE singleton_id = ?`,
      [singletonAccountStateId],
    );
    return row ?? undefined;
  }
}

async function applyChange(
  transaction: SqliteExecutor,
  accountId: string,
  change: SyncChange,
): Promise<void> {
  if (change.operation === 'reset') {
    await deleteHistory(transaction);
    await transaction.runAsync(
      'DELETE FROM synchronized_entities WHERE account_id = ?',
      [accountId],
    );
    return;
  }
  if (change.operation === 'delete') {
    await transaction.runAsync(
      `DELETE FROM synchronized_entities
       WHERE account_id = ? AND entity_kind = ? AND entity_id = ?`,
      [accountId, change.entityKind, change.entityId],
    );
    return;
  }
  if (change.payload === undefined) {
    throw new Error('An upsert must have a payload.');
  }
  if (
    change.entityKind === 'legalAcceptance' &&
    isLegalAcceptance(change.payload)
  ) {
    await transaction.runAsync(
      `INSERT INTO local_legal_acceptances(
        account_id, document_kind, document_version, locale, accepted_at_ms
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, document_kind, document_version) DO NOTHING`,
      [
        accountId,
        change.payload.documentKind,
        change.payload.documentVersion,
        change.payload.locale,
        change.payload.acceptedAtMilliseconds,
      ],
    );
  }
  await transaction.runAsync(
    `INSERT INTO synchronized_entities(
      account_id, entity_kind, entity_id, payload_json, cursor
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id, entity_kind, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      cursor = excluded.cursor`,
    [
      accountId,
      change.entityKind,
      change.entityId,
      JSON.stringify(change.payload),
      change.cursor,
    ],
  );
}

async function applyDispositions(
  transaction: SqliteExecutor,
  dispositions: readonly MutationDisposition[],
  sentMutations: readonly PendingMutation[],
): Promise<void> {
  const sentIds = new Set(sentMutations.map(({ mutationId }) => mutationId));
  for (const disposition of dispositions) {
    if (!sentIds.has(disposition.mutationId)) {
      throw new Error('Unexpected mutation disposition.');
    }
    if (disposition.kind === 'applied' || disposition.kind === 'duplicate') {
      await transaction.runAsync(
        'DELETE FROM sync_outbox WHERE mutation_id = ?',
        [disposition.mutationId],
      );
    } else if (disposition.kind === 'conflict') {
      await transaction.runAsync(
        `UPDATE sync_outbox SET state = 'conflict', last_error_code = 'conflict'
         WHERE mutation_id = ?`,
        [disposition.mutationId],
      );
    }
  }
}

async function deleteHistory(transaction: SqliteExecutor): Promise<void> {
  for (const table of [
    'area_feedback',
    'feedback_submissions',
    'routine_events',
    'routine_sessions',
    'decision_notices',
    'decision_reasons',
    'decision_area_inputs',
    'pause_today_events',
    'selection_decisions',
    'safety_events',
    'attention_states',
    'check_in_entries',
    'check_ins',
  ]) {
    await transaction.execAsync(`DELETE FROM ${table}`);
  }
}

function parseCommand(
  serialized: string,
  expectedKind: SyncCommand['kind'],
): SyncCommand | undefined {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('kind' in value) ||
      value.kind !== expectedKind
    ) {
      return undefined;
    }
    return value as SyncCommand;
  } catch {
    return undefined;
  }
}

function isLegalAcceptance(value: unknown): value is LegalAcceptance {
  return typeof value === 'object' &&
    value !== null &&
    'documentKind' in value &&
    (value.documentKind === 'termsOfService' ||
      value.documentKind === 'privacyPolicy') &&
    'documentVersion' in value &&
    typeof value.documentVersion === 'string' &&
    'locale' in value &&
    typeof value.locale === 'string' &&
    'acceptedAtMilliseconds' in value &&
    typeof value.acceptedAtMilliseconds === 'number' &&
    Number.isSafeInteger(value.acceptedAtMilliseconds) &&
    value.acceptedAtMilliseconds > 0;
}

function localFailure<Value>(): SyncResult<Value> {
  return { ok: false, error: { code: 'localPersistence' } };
}
