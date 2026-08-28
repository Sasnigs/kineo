import {
  bodyAreas,
  parseCheckInEntryId,
  parseCheckInId,
  type AreaRole,
  type BodyArea,
  type ChangeReport,
  type CheckInEntryId,
  type CheckInId,
  type ConditionalSafetyAnswer,
  type MovementComfort,
} from '../../core/domain/selection-domain';
import type { KineoStore } from '../../core/persistence/kineo-store';
import type {
  PersistenceError,
  PersistenceResult,
  SqliteDatabase,
  SqliteExecutor,
} from '../../core/persistence/persistence-contract';
import {
  checkInKinds,
  checkInStatuses,
  createAttentionState,
  createCheckIn,
  createCheckInEntry,
  createLocalDayContext,
  createProfileState,
  createSafetyMutation,
  parseLocalDay,
  telemetryChoices,
  type AttentionState,
  type CheckIn,
  type CheckInEntry,
  type CheckInKind,
  type CheckInStatus,
  type ProfileState,
  type SafetyMutation,
  type TelemetryChoice,
} from '../../core/persistence/persistence-domain';

const singletonProfileId = 1;
const falseInteger = 0;
const trueInteger = 1;

class StoreAbort extends Error {
  constructor(readonly persistenceError: PersistenceError) {
    super(persistenceError.code);
  }
}

type ProfileRow = Readonly<{
  onboarding_completed_at_ms: number | null;
  adult_acknowledged: number;
  safety_boundary_version: string | null;
  safety_acknowledged_at_ms: number | null;
  primary_area: string | null;
  secondary_area: string | null;
  routine_preference: string | null;
  weekly_goal_days: number;
  telemetry_choice: string;
  created_at_ms: number;
  updated_at_ms: number;
}>;

type ReminderRow = Readonly<{
  enabled: number;
  window_start_minutes: number | null;
  window_end_minutes: number | null;
  time_zone_id: string | null;
  updated_at_ms: number;
}>;

type CheckInRow = Readonly<{
  id: string;
  status: string;
  purpose: string;
  primary_area: string;
  secondary_area: string | null;
  correction_area: string | null;
  source_triggering_entry_id: string | null;
  started_at_ms: number;
  completed_at_ms: number | null;
  local_day: string;
  time_zone_id: string;
  calendar_id: string;
}>;

type CheckInEntryRow = Readonly<{
  id: string;
  area: string;
  role: string;
  change_report: string;
  movement_comfort: string;
  conditional_safety_answer: string | null;
  submitted_at_ms: number;
}>;

type AttentionRow = Readonly<{
  area: string;
  updated_at_ms: number;
}>;

type SafetyEventRow = Readonly<{
  id: string;
  area: string;
  kind: string;
  source_check_in_entry_id: string | null;
  return_answer: string | null;
  occurred_at_ms: number;
  local_day: string;
  time_zone_id: string;
  calendar_id: string;
}>;

function asBoolean(value: number): boolean | undefined {
  return value === trueInteger
    ? true
    : value === falseInteger
      ? false
      : undefined;
}

function oneOf<Value extends string>(
  value: string,
  values: readonly Value[],
): Value | undefined {
  return values.includes(value as Value) ? (value as Value) : undefined;
}

function asBodyArea(value: string | null): BodyArea | undefined {
  return value === null ? undefined : oneOf(value, bodyAreas);
}

function optionalBodyAreaOrAbort(value: string | null): BodyArea | undefined {
  if (value === null) {
    return undefined;
  }
  return definedOrAbort(oneOf(value, bodyAreas));
}

function definedOrAbort<Value>(
  value: Value | undefined,
  error: PersistenceError = { code: 'corruptedStore' },
): Value {
  if (value === undefined) {
    throw new StoreAbort(error);
  }
  return value;
}

function sqliteWriteFailure(error: unknown): PersistenceResult<void> {
  return error instanceof StoreAbort
    ? { ok: false, error: error.persistenceError }
    : { ok: false, error: { code: 'writeFailed' } };
}

function optional<Value>(value: Value | null): Value | undefined {
  return value === null ? undefined : value;
}

function checkInEntryIdOrAbort(value: string): CheckInEntryId {
  const parsed = parseCheckInEntryId(value);
  if (!parsed.ok) {
    throw new StoreAbort({ code: 'corruptedStore' });
  }
  return parsed.value;
}

export class KineoSqliteStore implements KineoStore {
  constructor(private readonly database: SqliteDatabase) {}

  async loadProfileState(): Promise<
    PersistenceResult<ProfileState | undefined>
  > {
    try {
      const row = await this.database.getFirstAsync<ProfileRow>(
        'SELECT * FROM user_profile WHERE singleton_id = ?',
        [singletonProfileId],
      );
      if (row === null) {
        return { ok: true, value: undefined };
      }
      const adultAcknowledged = definedOrAbort(
        asBoolean(row.adult_acknowledged),
      );
      const telemetryChoice = definedOrAbort(
        oneOf(row.telemetry_choice, telemetryChoices),
      );
      const reminder = await this.database.getFirstAsync<ReminderRow>(
        'SELECT * FROM reminder_settings WHERE singleton_id = ?',
        [singletonProfileId],
      );
      const reminderEnabled =
        reminder === null ? undefined : definedOrAbort(asBoolean(reminder.enabled));
      const result = createProfileState({
        profile: {
          onboardingCompletedAtMilliseconds: optional(
            row.onboarding_completed_at_ms,
          ),
          adultAcknowledged,
          safetyBoundaryVersion: optional(row.safety_boundary_version),
          safetyAcknowledgedAtMilliseconds: optional(
            row.safety_acknowledged_at_ms,
          ),
          primaryArea: optionalBodyAreaOrAbort(row.primary_area),
          secondaryArea: optionalBodyAreaOrAbort(row.secondary_area),
          routinePreference: optional(row.routine_preference),
          weeklyGoalDays: row.weekly_goal_days,
          telemetryChoice: telemetryChoice as TelemetryChoice,
          createdAtMilliseconds: row.created_at_ms,
          updatedAtMilliseconds: row.updated_at_ms,
        },
        reminderSettings:
          reminder === null || reminderEnabled === undefined
            ? undefined
            : {
                enabled: reminderEnabled,
                window:
                  reminder.window_start_minutes === null ||
                  reminder.window_end_minutes === null
                    ? undefined
                    : {
                        startMinutes: reminder.window_start_minutes,
                        endMinutes: reminder.window_end_minutes,
                      },
                timeZoneId: optional(reminder.time_zone_id),
                updatedAtMilliseconds: reminder.updated_at_ms,
              },
      });
      return result.ok
        ? result
        : { ok: false, error: { code: 'corruptedStore' } };
    } catch (error) {
      return error instanceof StoreAbort
        ? { ok: false, error: error.persistenceError }
        : { ok: false, error: { code: 'readFailed' } };
    }
  }

  async saveProfileState(state: ProfileState): Promise<PersistenceResult<void>> {
    const validated = createProfileState(state);
    if (!validated.ok) {
      return {
        ok: false,
        error: {
          code: 'constraintViolation',
          constraint: 'domainInvariant',
        },
      };
    }
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<{
          created_at_ms: number;
        }>('SELECT created_at_ms FROM user_profile WHERE singleton_id = ?', [
          singletonProfileId,
        ]);
        if (
          existing !== null &&
          existing.created_at_ms !== validated.value.profile.createdAtMilliseconds
        ) {
          throw new StoreAbort({
            code: 'constraintViolation',
            constraint: 'immutableRecord',
          });
        }
        const profile = validated.value.profile;
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
            updated_at_ms = excluded.updated_at_ms`,
          [
            singletonProfileId,
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
        const reminder = validated.value.reminderSettings;
        if (reminder === undefined) {
          await transaction.runAsync(
            'DELETE FROM reminder_settings WHERE singleton_id = ?',
            [singletonProfileId],
          );
          return;
        }
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
            singletonProfileId,
            reminder.enabled ? trueInteger : falseInteger,
            reminder.window?.startMinutes ?? null,
            reminder.window?.endMinutes ?? null,
            reminder.timeZoneId ?? null,
            reminder.updatedAtMilliseconds,
          ],
        );
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return sqliteWriteFailure(error);
    }
  }

  async loadCheckIn(
    id: CheckInId,
  ): Promise<PersistenceResult<CheckIn | undefined>> {
    try {
      const row = await this.database.getFirstAsync<CheckInRow>(
        'SELECT * FROM check_ins WHERE id = ?',
        [id],
      );
      if (row === null) {
        return { ok: true, value: undefined };
      }
      const entryRows = await this.database.getAllAsync<CheckInEntryRow>(
        'SELECT * FROM check_in_entries WHERE check_in_id = ? ORDER BY submitted_at_ms, id',
        [id],
      );
      const entries: CheckInEntry[] = [];
      for (const entryRow of entryRows) {
        const entry = createCheckInEntry({
          id: checkInEntryIdOrAbort(entryRow.id),
          area: definedOrAbort(asBodyArea(entryRow.area)),
          role: definedOrAbort(oneOf(entryRow.role, ['primary', 'secondary'] as const)) as AreaRole,
          changeReport: definedOrAbort(oneOf(entryRow.change_report, ['better', 'similar', 'worse'] as const)) as ChangeReport,
          movementComfort: definedOrAbort(oneOf(entryRow.movement_comfort, ['limited', 'okay', 'good'] as const)) as MovementComfort,
          conditionalSafetyAnswer: entryRow.conditional_safety_answer === null
            ? undefined
            : definedOrAbort(oneOf(entryRow.conditional_safety_answer, ['no', 'yes', 'notSure'] as const)) as ConditionalSafetyAnswer,
          submittedAtMilliseconds: entryRow.submitted_at_ms,
        });
        if (!entry.ok) {
          throw new StoreAbort({ code: 'corruptedStore' });
        }
        entries.push(entry.value);
      }
      const parsedId = parseCheckInId(row.id);
      const parsedDay = parseLocalDay(row.local_day);
      if (!parsedId.ok || !parsedDay.ok) {
        throw new StoreAbort({ code: 'corruptedStore' });
      }
      const context = createLocalDayContext({
        localDay: parsedDay.value,
        timeZoneId: row.time_zone_id,
        calendarId: row.calendar_id,
      });
      if (!context.ok) {
        throw new StoreAbort({ code: 'corruptedStore' });
      }
      const status = oneOf(row.status, checkInStatuses);
      const kind = oneOf(row.purpose, checkInKinds);
      const primaryArea = asBodyArea(row.primary_area);
      const secondaryArea = optionalBodyAreaOrAbort(row.secondary_area);
      if (status === undefined || kind === undefined || primaryArea === undefined) {
        throw new StoreAbort({ code: 'corruptedStore' });
      }
      const result = createCheckIn({
        id: parsedId.value,
        status: status as CheckInStatus,
        kind: kind as CheckInKind,
        correctionSource:
          row.correction_area === null
            ? undefined
            : {
                area: definedOrAbort(asBodyArea(row.correction_area)),
                triggeringEntryId:
                  row.source_triggering_entry_id === null
                    ? undefined
                    : checkInEntryIdOrAbort(row.source_triggering_entry_id),
              },
        primaryArea,
        secondaryArea,
        startedAtMilliseconds: row.started_at_ms,
        completedAtMilliseconds: optional(row.completed_at_ms),
        dayContext: context.value,
        entries,
      });
      return result.ok
        ? result
        : { ok: false, error: { code: 'corruptedStore' } };
    } catch (error) {
      return error instanceof StoreAbort
        ? { ok: false, error: error.persistenceError }
        : { ok: false, error: { code: 'readFailed' } };
    }
  }

  async saveCheckInDraft(checkIn: CheckIn): Promise<PersistenceResult<void>> {
    const validated = createCheckIn(checkIn);
    if (!validated.ok || validated.value.status !== 'draft') {
      return {
        ok: false,
        error: { code: 'constraintViolation', constraint: 'domainInvariant' },
      };
    }
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<{ status: string }>(
          'SELECT status FROM check_ins WHERE id = ?',
          [validated.value.id],
        );
        if (existing !== null && existing.status !== 'draft') {
          throw new StoreAbort({
            code: 'constraintViolation',
            constraint: 'immutableRecord',
          });
        }
        await this.upsertCheckIn(transaction, validated.value);
        await this.replaceCheckInEntries(transaction, validated.value);
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return sqliteWriteFailure(error);
    }
  }

  async completeCheckIn(
    checkIn: CheckIn,
    safetyMutations: readonly SafetyMutation[],
  ): Promise<PersistenceResult<void>> {
    const validated = createCheckIn(checkIn);
    if (!validated.ok || validated.value.status !== 'completed') {
      return {
        ok: false,
        error: { code: 'constraintViolation', constraint: 'domainInvariant' },
      };
    }
    const mutations: SafetyMutation[] = [];
    for (const inputMutation of safetyMutations) {
      const mutation = createSafetyMutation(inputMutation);
      if (!mutation.ok) {
        return {
          ok: false,
          error: { code: 'constraintViolation', constraint: 'domainInvariant' },
        };
      }
      const sourceId = mutation.value.event.sourceCheckInEntryId;
      if (
        sourceId !== undefined &&
        !validated.value.entries.some(
          (entry) => entry.id === sourceId && entry.area === mutation.value.event.area,
        )
      ) {
        return {
          ok: false,
          error: { code: 'constraintViolation', constraint: 'relationship' },
        };
      }
      mutations.push(mutation.value);
    }
    if (
      new Set(mutations.map((mutation) => mutation.event.area)).size !==
      mutations.length
    ) {
      return {
        ok: false,
        error: { code: 'constraintViolation', constraint: 'domainInvariant' },
      };
    }
    const expectedMutationSourceIds = new Set(
      validated.value.entries
        .filter(
          (entry) =>
            entry.conditionalSafetyAnswer === 'yes' ||
            entry.conditionalSafetyAnswer === 'notSure' ||
            entry.area === validated.value.correctionSource?.area,
        )
        .map((entry) => entry.id),
    );
    const actualMutationSourceIds = new Set(
      mutations.flatMap((mutation) =>
        mutation.event.sourceCheckInEntryId === undefined
          ? []
          : [mutation.event.sourceCheckInEntryId],
      ),
    );
    if (
      actualMutationSourceIds.size !== mutations.length ||
      actualMutationSourceIds.size !== expectedMutationSourceIds.size ||
      [...actualMutationSourceIds].some(
        (sourceId) => !expectedMutationSourceIds.has(sourceId),
      ) ||
      mutations.some((mutation) => {
        const sourceId = mutation.event.sourceCheckInEntryId;
        const source = validated.value.entries.find(
          (entry) => entry.id === sourceId,
        );
        if (source === undefined) {
          return true;
        }
        if (validated.value.correctionSource?.area === source.area) {
          return source.conditionalSafetyAnswer === 'yes' ||
            source.conditionalSafetyAnswer === 'notSure'
            ? mutation.event.kind !== 'attentionReaffirmedCorrection'
            : mutation.event.kind !== 'attentionClearedCorrection';
        }
        return mutation.event.kind !== 'attentionEntered';
      })
    ) {
      return {
        ok: false,
        error: { code: 'constraintViolation', constraint: 'domainInvariant' },
      };
    }

    const existing = await this.loadCheckIn(validated.value.id);
    if (!existing.ok) {
      return { ok: false, error: existing.error };
    }
    if (existing.value?.status === 'completed') {
      const isExactRetry = await this.isExactCompletedRetry(
        existing.value,
        validated.value,
        mutations,
      );
      return isExactRetry
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: 'conflictingWrite' } };
    }

    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<{ status: string }>(
          'SELECT status FROM check_ins WHERE id = ?',
          [validated.value.id],
        );
        if (existing === null) {
          throw new StoreAbort({ code: 'recordNotFound' });
        }
        if (existing.status !== 'draft') {
          throw new StoreAbort({ code: 'conflictingWrite' });
        }
        await this.replaceCheckInEntries(transaction, validated.value);
        await this.upsertCheckIn(transaction, validated.value);
        for (const mutation of mutations) {
          await this.applySafetyMutation(transaction, mutation);
        }
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return sqliteWriteFailure(error);
    }
  }

  async loadAttentionStates(): Promise<
    PersistenceResult<readonly AttentionState[]>
  > {
    try {
      const rows = await this.database.getAllAsync<AttentionRow>(
        'SELECT area, updated_at_ms FROM attention_states ORDER BY area',
      );
      const states: AttentionState[] = [];
      for (const row of rows) {
        const area = asBodyArea(row.area);
        if (area === undefined) {
          return { ok: false, error: { code: 'corruptedStore' } };
        }
        const state = createAttentionState({
          area,
          updatedAtMilliseconds: row.updated_at_ms,
        });
        if (!state.ok) {
          return { ok: false, error: { code: 'corruptedStore' } };
        }
        states.push(state.value);
      }
      return { ok: true, value: Object.freeze(states) };
    } catch {
      return { ok: false, error: { code: 'readFailed' } };
    }
  }

  async resetHistory(): Promise<PersistenceResult<void>> {
    const deletionOrder = [
      'area_feedback',
      'feedback_submissions',
      'routine_events',
      'routine_sessions',
      'decision_notices',
      'decision_reasons',
      'decision_area_inputs',
      'selection_decisions',
      'pause_today_events',
      'safety_events',
      'check_in_entries',
      'check_ins',
    ] as const;
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        for (const table of deletionOrder) {
          await transaction.execAsync(`DELETE FROM ${table}`);
        }
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return sqliteWriteFailure(error);
    }
  }

  private async upsertCheckIn(
    transaction: SqliteExecutor,
    checkIn: CheckIn,
  ): Promise<void> {
    await transaction.runAsync(
      `INSERT INTO check_ins(
        id, status, purpose, primary_area, secondary_area, correction_area,
        source_triggering_entry_id, started_at_ms, completed_at_ms,
        local_day, time_zone_id, calendar_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        purpose = excluded.purpose,
        primary_area = excluded.primary_area,
        secondary_area = excluded.secondary_area,
        correction_area = excluded.correction_area,
        source_triggering_entry_id = excluded.source_triggering_entry_id,
        started_at_ms = excluded.started_at_ms,
        completed_at_ms = excluded.completed_at_ms,
        local_day = excluded.local_day,
        time_zone_id = excluded.time_zone_id,
        calendar_id = excluded.calendar_id`,
      [
        checkIn.id,
        checkIn.status,
        checkIn.kind,
        checkIn.primaryArea,
        checkIn.secondaryArea ?? null,
        checkIn.correctionSource?.area ?? null,
        checkIn.correctionSource?.triggeringEntryId ?? null,
        checkIn.startedAtMilliseconds,
        checkIn.completedAtMilliseconds ?? null,
        checkIn.dayContext.localDay,
        checkIn.dayContext.timeZoneId,
        checkIn.dayContext.calendarId,
      ],
    );
  }

  private async replaceCheckInEntries(
    transaction: SqliteExecutor,
    checkIn: CheckIn,
  ): Promise<void> {
    await transaction.runAsync(
      'DELETE FROM check_in_entries WHERE check_in_id = ?',
      [checkIn.id],
    );
    for (const entry of checkIn.entries) {
      await transaction.runAsync(
        `INSERT INTO check_in_entries(
          id, check_in_id, area, role, change_report, movement_comfort,
          conditional_safety_answer, submitted_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  }

  private async applySafetyMutation(
    transaction: SqliteExecutor,
    mutation: SafetyMutation,
  ): Promise<void> {
    const current = await transaction.getFirstAsync<{
      updated_at_ms: number;
    }>('SELECT updated_at_ms FROM attention_states WHERE area = ?', [
      mutation.event.area,
    ]);
    if (mutation.event.kind === 'attentionEntered') {
      if (current !== null) {
        throw new StoreAbort({ code: 'conflictingWrite' });
      }
    } else if (
      current === null ||
      current.updated_at_ms !== mutation.expectedAttentionUpdatedAtMilliseconds
    ) {
      throw new StoreAbort({ code: 'conflictingWrite' });
    }

    const event = mutation.event;
    await transaction.runAsync(
      `INSERT INTO safety_events(
        id, area, kind, source_check_in_entry_id, return_answer,
        occurred_at_ms, local_day, time_zone_id, calendar_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.area,
        event.kind,
        event.sourceCheckInEntryId ?? null,
        event.returnAnswer ?? null,
        event.occurredAtMilliseconds,
        event.dayContext.localDay,
        event.dayContext.timeZoneId,
        event.dayContext.calendarId,
      ],
    );
    if (mutation.statusAfter === 'normal') {
      await transaction.runAsync('DELETE FROM attention_states WHERE area = ?', [
        event.area,
      ]);
      return;
    }
    await transaction.runAsync(
      `INSERT INTO attention_states(area, updated_at_ms) VALUES (?, ?)
       ON CONFLICT(area) DO UPDATE SET updated_at_ms = excluded.updated_at_ms`,
      [event.area, event.occurredAtMilliseconds],
    );
  }

  private async isExactCompletedRetry(
    stored: CheckIn,
    candidate: CheckIn,
    mutations: readonly SafetyMutation[],
  ): Promise<boolean> {
    if (JSON.stringify(stored) !== JSON.stringify(candidate)) {
      return false;
    }
    try {
      for (const mutation of mutations) {
        const event = mutation.event;
        const row = await this.database.getFirstAsync<SafetyEventRow>(
          'SELECT * FROM safety_events WHERE id = ?',
          [event.id],
        );
        if (
          row === null ||
          row.area !== event.area ||
          row.kind !== event.kind ||
          optional(row.source_check_in_entry_id) !==
            event.sourceCheckInEntryId ||
          optional(row.return_answer) !== event.returnAnswer ||
          row.occurred_at_ms !== event.occurredAtMilliseconds ||
          row.local_day !== event.dayContext.localDay ||
          row.time_zone_id !== event.dayContext.timeZoneId ||
          row.calendar_id !== event.dayContext.calendarId
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}
