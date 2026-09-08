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
import {
  createCheckIn,
  createProfileState,
  createReminderSettings,
  createSafetyEvent,
  type CheckIn,
  type ProfileState,
  type ReminderSettings,
  type SafetyEvent,
} from '../../core/persistence/persistence-domain';
import {
  createSelectionDecision,
  type SelectionDecision,
} from '../../core/persistence/decision-persistence-domain';
import {
  createFeedbackSubmission,
  createPauseTodayEvent,
  createRoutineEventMutation,
  createRoutineSession,
  isValidRoutineTransition,
  type FeedbackSubmission,
  type PauseTodayEvent,
  type RoutineCheckpoint,
  type RoutineEvent,
  type RoutineSession,
} from '../../core/persistence/routine-persistence-domain';

const singletonAccountStateId = 1;
const initialAttemptCount = 0;
const falseInteger = 0;
const trueInteger = 1;
const firstRoutineEventSequence = 1;

type AccountRow = Readonly<{
  account_id: string;
  installation_id: string;
  account_status: AccountState['status'];
  history_epoch: number;
  sync_cursor: string | null;
  hydrated: number;
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

  async isHydrated(): Promise<SyncResult<boolean>> {
    try {
      const row = await this.accountRow(this.database);
      return { ok: true, value: row?.hydrated === trueInteger };
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
      true,
      !page.hasMore,
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

  async resetForHistoryEpoch(historyEpoch: number, attentionStates: readonly Readonly<{ area: string; updatedAtMilliseconds: number }>[] = []): Promise<SyncResult<void>> {
    if (!Number.isSafeInteger(historyEpoch) || historyEpoch <= 0) {
      return localFailure();
    }
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        if (attentionStates.some((state) => !['neck', 'upperMidBack', 'lowerBack'].includes(state.area) ||
          !Number.isSafeInteger(state.updatedAtMilliseconds) || state.updatedAtMilliseconds <= 0)) {
          throw new Error('Invalid retained attention state.');
        }
        await deleteHistory(transaction);
        await transaction.runAsync(
          'DELETE FROM synchronized_entities WHERE account_id = ?',
          [this.accountId],
        );
        for (const state of attentionStates) {
          await transaction.runAsync(
            'INSERT INTO attention_states(area, updated_at_ms) VALUES (?, ?)',
            [state.area, state.updatedAtMilliseconds],
          );
        }
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
    completesHydration = false,
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
        if (cursor !== undefined && Number.isSafeInteger(Number(cursor))) {
          const reset = await transaction.getFirstAsync<{ cursor: string }>(
            `SELECT cursor FROM synchronized_entities WHERE account_id = ? AND entity_kind = 'history' LIMIT 1`,
            [this.accountId],
          );
          if (reset !== null && Number.isSafeInteger(Number(reset.cursor)) && Number(cursor) < Number(reset.cursor)) {
            throw new Error('Sync cursor predates the active history epoch.');
          }
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
          await applyChange(
            transaction,
            this.accountId,
            change,
          );
        }
        if (changes.some((change) => change.operation === 'reset')) {
          await transaction.runAsync(
            `UPDATE sync_outbox SET state = 'conflict', last_error_code = 'staleHistoryEpoch'
             WHERE account_id = ? AND state = 'pending'`,
            [this.accountId],
          );
        }
        await applyDispositions(transaction, dispositions, sentMutations);
        await transaction.runAsync(
          `UPDATE local_account_state
           SET account_status = ?, history_epoch = ?, sync_cursor = ?,
               last_synced_at_ms = ?, updated_at_ms = ?, hydrated = ?
           WHERE singleton_id = ? AND account_id = ? AND installation_id = ?`,
          [
            account.status,
            account.historyEpoch,
            cursor ?? row.sync_cursor,
            Date.now(),
            Date.now(),
            completesHydration ? trueInteger : row.hydrated,
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
      `SELECT account_id, installation_id, account_status, history_epoch, sync_cursor, hydrated
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
    const payload = asRecord(change.payload);
    const retained = payload?.attentionStates;
    if (!Array.isArray(retained) || retained.some((state) => {
      const value = asRecord(state);
      return value === undefined || !['neck', 'upperMidBack', 'lowerBack'].includes(String(value.area)) ||
        !Number.isSafeInteger(value.updatedAtMilliseconds) || Number(value.updatedAtMilliseconds) <= 0;
    })) throw new Error('Invalid reset retention payload.');
    for (const state of retained) {
      const value = state as { area: string; updatedAtMilliseconds: number };
      await transaction.runAsync('INSERT INTO attention_states(area, updated_at_ms) VALUES (?, ?)', [value.area, value.updatedAtMilliseconds]);
    }
    await transaction.runAsync(
      `INSERT INTO synchronized_entities(account_id, entity_kind, entity_id, payload_json, cursor)
       VALUES (?, 'history', ?, ?, ?)
       ON CONFLICT(account_id, entity_kind, entity_id) DO UPDATE SET payload_json = excluded.payload_json, cursor = excluded.cursor`,
      [accountId, change.entityId, JSON.stringify(change.payload), change.cursor],
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
  await projectChange(transaction, change);
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
    } else {
      await transaction.runAsync(
        `UPDATE sync_outbox SET state = 'conflict', last_error_code = ?
         WHERE mutation_id = ?`,
        [disposition.kind === 'conflict' ? 'conflict' : disposition.code,
          disposition.mutationId],
      );
    }
  }
}

async function projectChange(
  transaction: SqliteExecutor,
  change: SyncChange,
): Promise<void> {
  switch (change.entityKind) {
    case 'profile':
      return projectProfile(transaction, change.payload);
    case 'reminderSettings':
      return projectReminderSettings(transaction, change.payload);
    case 'checkIn':
      return projectCheckIn(transaction, change.payload);
    case 'safetyEvent':
      return projectSafetyEvent(transaction, change.payload);
    case 'pauseToday':
      return projectPauseToday(transaction, change.payload);
    case 'selectionDecision':
      return projectSelectionDecision(transaction, change.payload);
    case 'routineSession':
      return projectRoutineSession(transaction, change.payload);
    case 'routineEvent':
      return projectRoutineEvent(transaction, change.payload);
    case 'feedback':
      return projectFeedback(transaction, change.payload);
    case 'legalAcceptance':
    case 'history':
      return;
    default:
      throw new Error('Unsupported synchronized entity kind.');
  }
}

async function projectProfile(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const state = createProfileState({ profile: payload as ProfileState['profile'] });
  if (!state.ok) throw new Error('Invalid synchronized profile.');
  const profile = state.value.profile;
  await transaction.runAsync(
    `INSERT INTO user_profile(
      singleton_id, onboarding_completed_at_ms, adult_acknowledged,
      safety_boundary_version, safety_acknowledged_at_ms, primary_area,
      secondary_area, routine_preference, weekly_goal_days,
      telemetry_choice, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton_id) DO UPDATE SET
      onboarding_completed_at_ms = excluded.onboarding_completed_at_ms,
      adult_acknowledged = excluded.adult_acknowledged,
      safety_boundary_version = excluded.safety_boundary_version,
      safety_acknowledged_at_ms = excluded.safety_acknowledged_at_ms,
      primary_area = excluded.primary_area,
      secondary_area = excluded.secondary_area,
      routine_preference = excluded.routine_preference,
      weekly_goal_days = excluded.weekly_goal_days,
      telemetry_choice = excluded.telemetry_choice,
      created_at_ms = excluded.created_at_ms,
      updated_at_ms = excluded.updated_at_ms`,
    [
      singletonAccountStateId,
      profile.onboardingCompletedAtMilliseconds ?? null,
      profile.adultAcknowledged ? trueInteger : falseInteger,
      profile.safetyBoundaryVersion ?? null,
      profile.safetyAcknowledgedAtMilliseconds ?? null,
      profile.primaryArea ?? null,
      profile.secondaryArea ?? null,
      profile.routinePreference ?? null,
      profile.weeklyGoalDays,
      profile.telemetryChoice,
      profile.createdAtMilliseconds,
      profile.updatedAtMilliseconds,
    ],
  );
}

async function projectReminderSettings(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const settings = createReminderSettings(payload as ReminderSettings);
  if (!settings.ok) throw new Error('Invalid synchronized reminder settings.');
  await transaction.runAsync(
    `INSERT INTO reminder_settings(
      singleton_id, enabled, window_start_minutes, window_end_minutes,
      time_zone_id, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(singleton_id) DO UPDATE SET
      enabled = excluded.enabled,
      window_start_minutes = excluded.window_start_minutes,
      window_end_minutes = excluded.window_end_minutes,
      time_zone_id = excluded.time_zone_id,
      updated_at_ms = excluded.updated_at_ms`,
    [
      singletonAccountStateId,
      settings.value.enabled ? trueInteger : falseInteger,
      settings.value.window?.startMinutes ?? null,
      settings.value.window?.endMinutes ?? null,
      settings.value.timeZoneId ?? null,
      settings.value.updatedAtMilliseconds,
    ],
  );
}

async function projectCheckIn(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const validated = createCheckIn(payload as CheckIn);
  if (!validated.ok) throw new Error('Invalid synchronized check-in.');
  const checkIn = validated.value;
  await transaction.runAsync(
    `DELETE FROM check_in_entries WHERE check_in_id = ? AND EXISTS (
      SELECT 1 FROM check_ins WHERE id = ? AND status = 'draft'
    )`,
    [checkIn.id, checkIn.id],
  );
  await transaction.runAsync(
    `INSERT INTO check_ins(
      id, status, purpose, primary_area, secondary_area, correction_area,
      source_triggering_entry_id, started_at_ms, completed_at_ms, local_day,
      time_zone_id, calendar_id
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, purpose = excluded.purpose,
      primary_area = excluded.primary_area, secondary_area = excluded.secondary_area,
      correction_area = excluded.correction_area,
      completed_at_ms = excluded.completed_at_ms
    WHERE check_ins.status = 'draft'`,
    [
      checkIn.id,
      checkIn.status,
      checkIn.kind,
      checkIn.primaryArea,
      checkIn.secondaryArea ?? null,
      checkIn.correctionSource?.area ?? null,
      checkIn.startedAtMilliseconds,
      checkIn.completedAtMilliseconds ?? null,
      checkIn.dayContext.localDay,
      checkIn.dayContext.timeZoneId,
      checkIn.dayContext.calendarId,
    ],
  );
  for (const entry of checkIn.entries) {
    await transaction.runAsync(
      `INSERT INTO check_in_entries(
        id, check_in_id, area, role, change_report, movement_comfort,
        conditional_safety_answer, submitted_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      [
        entry.id,
        checkIn.id,
        entry.area,
        entry.role,
        entry.changeReport,
        entry.movementComfort,
        entry.conditionalSafetyAnswer ?? null,
        entry.submittedAtMilliseconds,
      ],
    );
  }
  if (checkIn.correctionSource?.triggeringEntryId !== undefined) {
    await transaction.runAsync(
      `UPDATE check_ins SET source_triggering_entry_id = ? WHERE id = ?`,
      [checkIn.correctionSource.triggeringEntryId, checkIn.id],
    );
  }
}

async function projectSafetyEvent(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const record = asRecord(payload);
  const event = createSafetyEvent(payload as SafetyEvent);
  if (
    record === undefined ||
    !event.ok ||
    (record.statusAfter !== 'normal' && record.statusAfter !== 'attentionRequired')
  ) throw new Error('Invalid synchronized safety event.');
  const value = event.value;
  const existing = await transaction.getFirstAsync<{ id: string }>(
    'SELECT id FROM safety_events WHERE id = ?', [value.id],
  );
  // A duplicate immutable event is an acknowledgement, not a new transition.
  if (existing !== null) return;
  await transaction.runAsync(
    `INSERT INTO safety_events(
      id, area, kind, source_check_in_entry_id, return_answer,
      occurred_at_ms, local_day, time_zone_id, calendar_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      value.id,
      value.area,
      value.kind,
      value.sourceCheckInEntryId ?? null,
      value.returnAnswer ?? null,
      value.occurredAtMilliseconds,
      value.dayContext.localDay,
      value.dayContext.timeZoneId,
      value.dayContext.calendarId,
    ],
  );
  if (record.statusAfter === 'attentionRequired') {
    await transaction.runAsync(
      `INSERT INTO attention_states(area, updated_at_ms) VALUES (?, ?)
       ON CONFLICT(area) DO UPDATE SET updated_at_ms = excluded.updated_at_ms`,
      [value.area, value.occurredAtMilliseconds],
    );
  } else {
    await transaction.runAsync('DELETE FROM attention_states WHERE area = ?', [value.area]);
  }
}

async function projectPauseToday(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const event = createPauseTodayEvent(payload as PauseTodayEvent);
  if (!event.ok) throw new Error('Invalid synchronized pause event.');
  await transaction.runAsync(
    `INSERT INTO pause_today_events(
      id, check_in_id, chosen_at_ms, local_day, time_zone_id, calendar_id
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      event.value.id,
      event.value.checkInId,
      event.value.chosenAtMilliseconds,
      event.value.dayContext.localDay,
      event.value.dayContext.timeZoneId,
      event.value.dayContext.calendarId,
    ],
  );
}

async function projectSelectionDecision(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const record = asRecord(payload);
  const candidate = asRecord(record?.canonicalDecision) ?? record;
  if (candidate === undefined || !Array.isArray(candidate.areaInputs)) {
    throw new Error('Invalid synchronized selection decision.');
  }
  const decision = createSelectionDecision(candidate as SelectionDecision);
  if (!decision.ok) throw new Error('Invalid synchronized selection decision.');
  const value = decision.value;
  await transaction.runAsync(
    `INSERT INTO selection_decisions(
      id, check_in_id, revision, rules_version, catalog_version_requested,
      catalog_version_delivered, outcome, recommended_level,
      requested_override, override_disposition, selected_level,
      delivered_level, duration_variant, secondary_omission_reason,
      validation_result, primary_template_id, primary_template_revision,
      secondary_module_id, secondary_module_revision,
      compatibility_rule_id, composition_fingerprint, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      catalog_version_delivered = excluded.catalog_version_delivered,
      outcome = excluded.outcome,
      recommended_level = excluded.recommended_level,
      requested_override = excluded.requested_override,
      override_disposition = excluded.override_disposition,
      selected_level = excluded.selected_level,
      delivered_level = excluded.delivered_level,
      duration_variant = excluded.duration_variant,
      secondary_omission_reason = excluded.secondary_omission_reason,
      validation_result = excluded.validation_result,
      primary_template_id = excluded.primary_template_id,
      primary_template_revision = excluded.primary_template_revision,
      secondary_module_id = excluded.secondary_module_id,
      secondary_module_revision = excluded.secondary_module_revision,
      compatibility_rule_id = excluded.compatibility_rule_id,
      composition_fingerprint = excluded.composition_fingerprint`,
    [
      value.id,
      value.checkInId,
      value.revision,
      value.rulesVersion,
      value.catalogVersionRequested,
      value.catalogVersionDelivered ?? null,
      value.outcome,
      value.recommendedLevel,
      value.requestedOverride ?? null,
      value.overrideDisposition,
      value.selectedLevel,
      value.deliveredLevel ?? null,
      value.duration,
      value.secondaryOmissionReason ?? null,
      value.validationResult,
      value.primaryTemplateId ?? null,
      value.primaryTemplateRevision ?? null,
      value.secondaryModuleId ?? null,
      value.secondaryModuleRevision ?? null,
      value.compatibilityRuleId ?? null,
      value.compositionFingerprint ?? null,
      value.createdAtMilliseconds,
    ],
  );
  await transaction.runAsync('DELETE FROM decision_area_inputs WHERE decision_id = ?', [value.id]);
  await transaction.runAsync('DELETE FROM decision_reasons WHERE decision_id = ?', [value.id]);
  await transaction.runAsync('DELETE FROM decision_notices WHERE decision_id = ?', [value.id]);
  for (const input of value.areaInputs) {
    await transaction.runAsync(
      `INSERT INTO decision_area_inputs(
        decision_id, area, role, check_in_entry_id, base_level,
        active_unlocked, qualifying_count, latest_response, included
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        value.id,
        input.area,
        input.role,
        input.checkInEntryId,
        input.baseLevel,
        input.activeUnlocked ? trueInteger : falseInteger,
        input.qualifyingCount,
        input.latestResponse ?? null,
        input.included ? trueInteger : falseInteger,
      ],
    );
  }
  for (const reason of value.reasons) {
    await transaction.runAsync(
      `INSERT INTO decision_reasons(
        decision_id, kind, position, reason_code, parameters_json
      ) VALUES (?, ?, ?, ?, ?)`,
      [value.id, reason.kind, reason.position, reason.code, JSON.stringify(reason.parameters)],
    );
  }
  for (const notice of value.notices) {
    await transaction.runAsync(
      `INSERT INTO decision_notices(
        decision_id, position, notice_code, area, parameters_json
      ) VALUES (?, ?, ?, ?, ?)`,
      [value.id, notice.position, notice.code, notice.area ?? null, JSON.stringify(notice.parameters)],
    );
  }
}

async function projectRoutineSession(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const record = asRecord(payload);
  const routineCandidate = asRecord(record?.routine);
  if (record === undefined || routineCandidate === undefined) {
    throw new Error('Invalid synchronized routine session.');
  }
  const routine = createRoutineSession(routineCandidate as RoutineSession);
  if (!routine.ok) throw new Error('Invalid synchronized routine session.');
  const value = routine.value;
  // The feed includes creation followed by every ordered lifecycle event.
  // Snapshot echoes must not rewind a newer, locally queued checkpoint.
  await transaction.runAsync(
    `INSERT INTO routine_sessions(
      id, decision_id, check_in_id, status, routine_snapshot_json,
      snapshot_checksum, current_step_index, step_elapsed_ms,
      started_at_ms, updated_at_ms, ended_at_ms, local_day,
      time_zone_id, calendar_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      value.id,
      value.decisionId,
      value.checkInId,
      value.status,
      value.snapshot.json,
      value.snapshot.checksum,
      value.currentStepIndex,
      value.stepElapsedMilliseconds,
      value.startedAtMilliseconds ?? null,
      value.updatedAtMilliseconds,
      value.endedAtMilliseconds ?? null,
      value.dayContext.localDay,
      value.dayContext.timeZoneId,
      value.dayContext.calendarId,
    ],
  );
}

async function projectRoutineEvent(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const record = asRecord(payload);
  if (record === undefined) throw new Error('Invalid synchronized routine event.');
  const checkpoint: RoutineCheckpoint = {
    status: record.resultingStatus as RoutineCheckpoint['status'],
    currentStepIndex: record.resultingStepIndex as number,
    stepElapsedMilliseconds: record.resultingStepElapsedMilliseconds as number,
    updatedAtMilliseconds: record.resultingUpdatedAtMilliseconds as number,
    ...(typeof record.resultingEndedAtMilliseconds === 'number'
      ? { endedAtMilliseconds: record.resultingEndedAtMilliseconds }
      : {}),
  };
  const mutation = createRoutineEventMutation(record as RoutineEvent, checkpoint);
  if (!mutation.ok) throw new Error('Invalid synchronized routine event.');
  const localRoutine = await transaction.getFirstAsync<{
    id: string; status: RoutineSession['status']; started_at_ms: number | null;
  }>(
    'SELECT id, status, started_at_ms FROM routine_sessions WHERE id = ?',
    [mutation.value.event.routineSessionId],
  );
  if (localRoutine === null) throw new Error('Synchronized routine event has no session.');
  const event = mutation.value.event;
  const latest = await transaction.getFirstAsync<{ sequence_number: number | null }>(
    'SELECT max(sequence_number) AS sequence_number FROM routine_events WHERE routine_session_id = ?',
    [event.routineSessionId],
  );
  const latestSequence = latest?.sequence_number ?? 0;
  if (event.sequenceNumber <= latestSequence) {
    const existing = await transaction.getFirstAsync<{ id: string }>(
      `SELECT id FROM routine_events WHERE id = ? AND routine_session_id = ?
       AND sequence_number = ? AND kind = ? AND occurred_at_ms = ?
       AND step_id IS ? AND module_id IS ? AND alternative_id IS ? AND local_reason_code IS ?
       AND resulting_status = ? AND resulting_step_index = ? AND resulting_step_elapsed_ms = ?
       AND resulting_updated_at_ms = ? AND resulting_ended_at_ms IS ?`,
      [event.id, event.routineSessionId, event.sequenceNumber, event.kind,
        event.occurredAtMilliseconds, event.stepId ?? null, event.moduleId ?? null,
        event.alternativeId ?? null, event.localReason ?? null, checkpoint.status,
        checkpoint.currentStepIndex, checkpoint.stepElapsedMilliseconds,
        checkpoint.updatedAtMilliseconds, checkpoint.endedAtMilliseconds ?? null],
    );
    if (existing === null) throw new Error('Synchronized event conflicts with local history.');
    return;
  }
  if (event.sequenceNumber !== latestSequence + firstRoutineEventSequence ||
      !isValidRoutineTransition(localRoutine.status, event.kind, checkpoint.status)) {
    throw new Error('Synchronized event is missing an earlier lifecycle transition.');
  }
  await transaction.runAsync(
    `INSERT INTO routine_events(
      id, routine_session_id, sequence_number, kind, step_id, module_id,
      alternative_id, local_reason_code, occurred_at_ms, resulting_status,
      resulting_step_index, resulting_step_elapsed_ms, resulting_updated_at_ms,
      resulting_ended_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      event.id,
      event.routineSessionId,
      event.sequenceNumber,
      event.kind,
      event.stepId ?? null,
      event.moduleId ?? null,
      event.alternativeId ?? null,
      event.localReason ?? null,
      event.occurredAtMilliseconds,
      checkpoint.status,
      checkpoint.currentStepIndex,
      checkpoint.stepElapsedMilliseconds,
      checkpoint.updatedAtMilliseconds,
      checkpoint.endedAtMilliseconds ?? null,
    ],
  );
  await transaction.runAsync(
    `UPDATE routine_sessions SET
      status = ?, current_step_index = ?, step_elapsed_ms = ?,
      updated_at_ms = ?, ended_at_ms = ?, started_at_ms = ?
     WHERE id = ?`,
    [
      checkpoint.status,
      checkpoint.currentStepIndex,
      checkpoint.stepElapsedMilliseconds,
      checkpoint.updatedAtMilliseconds,
      checkpoint.endedAtMilliseconds ?? null,
      event.kind === 'started' ? event.occurredAtMilliseconds : localRoutine.started_at_ms,
      event.routineSessionId,
    ],
  );
}

async function projectFeedback(
  transaction: SqliteExecutor,
  payload: unknown,
): Promise<void> {
  const submission = createFeedbackSubmission(payload as FeedbackSubmission);
  if (!submission.ok) throw new Error('Invalid synchronized feedback.');
  const routine = await transaction.getFirstAsync<{ id: string }>(
    'SELECT id FROM routine_sessions WHERE id = ?',
    [submission.value.routineSessionId],
  );
  if (routine === null) return;
  await transaction.runAsync(
    `INSERT INTO feedback_submissions(
      id, routine_session_id, submitted_at_ms, local_day, time_zone_id, calendar_id
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`,
    [
      submission.value.id,
      submission.value.routineSessionId,
      submission.value.submittedAtMilliseconds,
      submission.value.dayContext.localDay,
      submission.value.dayContext.timeZoneId,
      submission.value.dayContext.calendarId,
    ],
  );
  for (const response of submission.value.responses) {
    await transaction.runAsync(
      `INSERT INTO area_feedback(
        id, feedback_submission_id, area, response, submitted_at_ms,
        local_day, time_zone_id, calendar_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
      [
        response.id,
        submission.value.id,
        response.area,
        response.response,
        submission.value.submittedAtMilliseconds,
        submission.value.dayContext.localDay,
        submission.value.dayContext.timeZoneId,
        submission.value.dayContext.calendarId,
      ],
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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
