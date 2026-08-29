import {
  parseRoutineSessionId,
  type RoutineSessionId,
} from '../../core/content/routine-session-snapshot';
import {
  bodyAreas,
  parseCheckInId,
  parseSelectionDecisionId,
  type BodyArea,
  type RoutineStatus,
} from '../../core/domain/selection-domain';
import type {
  PersistenceError,
  PersistenceResult,
  SqliteDatabase,
  SqliteExecutor,
  SqlValue,
} from '../../core/persistence/persistence-contract';
import {
  createLocalDayContext,
  parseLocalDay,
  type LocalDay,
} from '../../core/persistence/persistence-domain';
import {
  createFeedbackSubmission,
  createOpaqueRoutineSnapshot,
  createPauseTodayEvent,
  createRoutineEvent,
  createRoutineCheckpoint,
  createRoutineEventMutation,
  createRoutineSession,
  isValidRoutineTransition,
  parsePauseTodayEventId,
  parseRoutineEventId,
  parseRoutineStatus,
  routineEventKinds,
  routineEventReasons,
  type FeedbackSubmission,
  type PauseTodayEvent,
  type RoutineCheckpoint,
  type RoutineEvent,
  type RoutineSession,
} from '../../core/persistence/routine-persistence-domain';

const falseInteger = 0;
const trueInteger = 1;
const firstSequenceNumber = 1;
const gentleLevel = 'gentle';

class RepositoryAbort extends Error {
  constructor(readonly persistenceError: PersistenceError) {
    super(persistenceError.code);
  }
}

function oneOf<Value extends string>(value: string, values: readonly Value[]): Value | undefined {
  return values.includes(value as Value) ? (value as Value) : undefined;
}

function writeFailure(error: unknown): PersistenceResult<void> {
  return error instanceof RepositoryAbort
    ? { ok: false, error: error.persistenceError }
    : { ok: false, error: { code: 'writeFailed' } };
}

function validateFailure(): PersistenceResult<void> {
  return { ok: false, error: { code: 'constraintViolation', constraint: 'domainInvariant' } };
}

type PauseRow = Readonly<{
  id: string;
  check_in_id: string;
  chosen_at_ms: number;
  local_day: string;
  time_zone_id: string;
  calendar_id: string;
}>;

type SessionRow = Readonly<{
  id: string;
  decision_id: string;
  check_in_id: string;
  status: string;
  routine_snapshot_json: string;
  snapshot_checksum: string;
  current_step_index: number;
  step_elapsed_ms: number;
  started_at_ms: number | null;
  updated_at_ms: number;
  ended_at_ms: number | null;
  local_day: string;
  time_zone_id: string;
  calendar_id: string;
}>;

type EventRow = Readonly<{
  id: string;
  routine_session_id: string;
  sequence_number: number;
  kind: string;
  step_id: string | null;
  module_id: string | null;
  alternative_id: string | null;
  local_reason_code: string | null;
  occurred_at_ms: number;
  resulting_status: string;
  resulting_step_index: number;
  resulting_step_elapsed_ms: number;
  resulting_updated_at_ms: number;
  resulting_ended_at_ms: number | null;
}>;

type FeedbackRow = Readonly<{
  id: string;
  routine_session_id: string;
  submitted_at_ms: number;
  local_day: string;
  time_zone_id: string;
  calendar_id: string;
}>;

type AreaFeedbackRow = Readonly<{
  id: string;
  area: string;
  response: string;
  submitted_at_ms: number;
  local_day: string;
  time_zone_id: string;
  calendar_id: string;
}>;

function sameDayContext(
  row: Pick<PauseRow, 'local_day' | 'time_zone_id' | 'calendar_id'>,
  context: PauseTodayEvent['dayContext'],
): boolean {
  return row.local_day === context.localDay &&
    row.time_zone_id === context.timeZoneId &&
    row.calendar_id === context.calendarId;
}

export class KineoSqliteRoutineRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async recordPauseToday(event: PauseTodayEvent): Promise<PersistenceResult<void>> {
    const validated = createPauseTodayEvent(event);
    if (!validated.ok) return validateFailure();
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<PauseRow>(
          'SELECT * FROM pause_today_events WHERE id = ?',
          [event.id],
        );
        if (existing !== null) {
          if (
            existing.check_in_id === event.checkInId &&
            existing.chosen_at_ms === event.chosenAtMilliseconds &&
            sameDayContext(existing, event.dayContext)
          ) return;
          throw new RepositoryAbort({ code: 'conflictingWrite' });
        }
        const checkIn = await transaction.getFirstAsync<{ status: string }>(
          'SELECT status FROM check_ins WHERE id = ?',
          [event.checkInId],
        );
        if (checkIn?.status !== 'completed') throw new RepositoryAbort({ code: 'recordNotFound' });
        const attention = await this.count(transaction, 'SELECT count(*) AS count FROM attention_states');
        const eligible = await this.count(
          transaction,
          `SELECT count(*) AS count FROM check_in_entries
           WHERE check_in_id = ? AND (change_report = 'worse' OR movement_comfort = 'limited')
             AND conditional_safety_answer = 'no'`,
          [event.checkInId],
        );
        const unsafe = await this.count(
          transaction,
          `SELECT count(*) AS count FROM check_in_entries
           WHERE check_in_id = ? AND conditional_safety_answer IN ('yes', 'notSure')`,
          [event.checkInId],
        );
        const decision = await transaction.getFirstAsync<{ outcome: string; recommended_level: string }>(
          'SELECT outcome, recommended_level FROM selection_decisions WHERE check_in_id = ? ORDER BY revision DESC LIMIT 1',
          [event.checkInId],
        );
        const routineCount = await this.count(
          transaction,
          'SELECT count(*) AS count FROM routine_sessions WHERE check_in_id = ?',
          [event.checkInId],
        );
        if (
          attention !== falseInteger ||
          eligible < trueInteger ||
          unsafe !== falseInteger ||
          decision?.outcome !== 'selected' ||
          decision.recommended_level !== gentleLevel ||
          routineCount !== falseInteger
        ) throw new RepositoryAbort({ code: 'conflictingWrite' });
        await transaction.runAsync(
          `INSERT INTO pause_today_events(id, check_in_id, chosen_at_ms, local_day, time_zone_id, calendar_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [event.id, event.checkInId, event.chosenAtMilliseconds, event.dayContext.localDay,
            event.dayContext.timeZoneId, event.dayContext.calendarId],
        );
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return writeFailure(error);
    }
  }

  async loadPauseToday(localDay: LocalDay): Promise<PersistenceResult<PauseTodayEvent | undefined>> {
    try {
      const row = await this.database.getFirstAsync<PauseRow>(
        'SELECT * FROM pause_today_events WHERE local_day = ? ORDER BY chosen_at_ms DESC LIMIT 1',
        [localDay],
      );
      return row === null
        ? { ok: true, value: undefined }
        : { ok: true, value: this.pauseFromRow(row) };
    } catch (error) {
      return this.readFailure(error);
    }
  }

  async createRoutine(session: RoutineSession): Promise<PersistenceResult<void>> {
    const validated = createRoutineSession(session);
    if (!validated.ok || session.status !== 'prepared') return validateFailure();
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const decision = await transaction.getFirstAsync<{
          check_in_id: string;
          outcome: string;
          revision: number;
        }>('SELECT check_in_id, outcome, revision FROM selection_decisions WHERE id = ?', [session.decisionId]);
        if (decision?.check_in_id !== session.checkInId || decision.outcome !== 'selected') {
          throw new RepositoryAbort({ code: 'constraintViolation', constraint: 'relationship' });
        }
        const latest = await transaction.getFirstAsync<{ revision: number | null }>(
          'SELECT max(revision) AS revision FROM selection_decisions WHERE check_in_id = ?',
          [session.checkInId],
        );
        if (decision.revision !== latest?.revision) throw new RepositoryAbort({ code: 'conflictingWrite' });
        const areaRows = await transaction.getAllAsync<{ area: string }>(
          'SELECT area FROM decision_area_inputs WHERE decision_id = ? AND included = 1 ORDER BY area',
          [session.decisionId],
        );
        const expectedAreas = [...session.snapshot.includedAreas].sort();
        if (JSON.stringify(areaRows.map(({ area }) => area).sort()) !== JSON.stringify(expectedAreas)) {
          throw new RepositoryAbort({ code: 'constraintViolation', constraint: 'relationship' });
        }
        const attention = await this.count(transaction, 'SELECT count(*) AS count FROM attention_states');
        const pause = await this.count(
          transaction,
          'SELECT count(*) AS count FROM pause_today_events WHERE check_in_id = ?',
          [session.checkInId],
        );
        if (attention !== falseInteger || pause !== falseInteger) {
          throw new RepositoryAbort({ code: 'conflictingWrite' });
        }
        await transaction.runAsync(
          `INSERT INTO routine_sessions(
            id, decision_id, check_in_id, status, routine_snapshot_json, snapshot_checksum,
            current_step_index, step_elapsed_ms, started_at_ms, updated_at_ms, ended_at_ms,
            local_day, time_zone_id, calendar_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [session.id, session.decisionId, session.checkInId, session.status, session.snapshot.json,
            session.snapshot.checksum, session.currentStepIndex, session.stepElapsedMilliseconds,
            session.startedAtMilliseconds ?? null, session.updatedAtMilliseconds,
            session.endedAtMilliseconds ?? null, session.dayContext.localDay,
            session.dayContext.timeZoneId, session.dayContext.calendarId],
        );
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return writeFailure(error);
    }
  }

  async loadRoutineSession(id: RoutineSessionId): Promise<PersistenceResult<RoutineSession | undefined>> {
    try {
      const row = await this.database.getFirstAsync<SessionRow>(
        'SELECT * FROM routine_sessions WHERE id = ?',
        [id],
      );
      if (row === null) return { ok: true, value: undefined };
      const session = this.sessionFromRow(row);
      const events = await this.database.getAllAsync<EventRow>(
        'SELECT * FROM routine_events WHERE routine_session_id = ? ORDER BY sequence_number',
        [id],
      );
      this.validateAudit(session, events);
      return { ok: true, value: session };
    } catch (error) {
      return this.readFailure(error);
    }
  }

  async loadNonterminalRoutine(): Promise<PersistenceResult<RoutineSession | undefined>> {
    try {
      const row = await this.database.getFirstAsync<SessionRow>(
        "SELECT * FROM routine_sessions WHERE status IN ('prepared', 'inProgress', 'paused') LIMIT 1",
      );
      if (row === null) return { ok: true, value: undefined };
      const session = this.sessionFromRow(row);
      const events = await this.database.getAllAsync<EventRow>(
        'SELECT * FROM routine_events WHERE routine_session_id = ? ORDER BY sequence_number',
        [session.id],
      );
      this.validateAudit(session, events);
      return { ok: true, value: session };
    } catch (error) {
      return this.readFailure(error);
    }
  }

  async recordRoutineEvent(
    event: RoutineEvent,
    checkpoint: RoutineCheckpoint,
  ): Promise<PersistenceResult<void>> {
    const validated = createRoutineEventMutation(event, checkpoint);
    if (!validated.ok) return validateFailure();
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<EventRow>(
          'SELECT * FROM routine_events WHERE id = ?',
          [event.id],
        );
        if (existing !== null) {
          if (this.eventRowMatches(existing, event, checkpoint)) return;
          throw new RepositoryAbort({ code: 'conflictingWrite' });
        }
        const current = await transaction.getFirstAsync<{
          status: string;
          started_at_ms: number | null;
          updated_at_ms: number;
        }>('SELECT status, started_at_ms, updated_at_ms FROM routine_sessions WHERE id = ?', [event.routineSessionId]);
        const currentStatus = current === null ? undefined : parseRoutineStatus(current.status);
        if (current === null || currentStatus === undefined) throw new RepositoryAbort({ code: 'recordNotFound' });
        if (
          event.occurredAtMilliseconds < current.updated_at_ms ||
          !isValidRoutineTransition(currentStatus, event.kind, checkpoint.status) ||
          (checkpoint.endedAtMilliseconds !== undefined && current.started_at_ms !== null &&
            checkpoint.endedAtMilliseconds < current.started_at_ms)
        ) throw new RepositoryAbort({ code: 'invalidLifecycleTransition' });
        const prior = await transaction.getFirstAsync<{ sequence_number: number | null }>(
          'SELECT max(sequence_number) AS sequence_number FROM routine_events WHERE routine_session_id = ?',
          [event.routineSessionId],
        );
        const expectedSequence = (prior?.sequence_number ?? falseInteger) + firstSequenceNumber;
        if (event.sequenceNumber !== expectedSequence) throw new RepositoryAbort({ code: 'conflictingWrite' });
        await transaction.runAsync(
          `INSERT INTO routine_events(
            id, routine_session_id, sequence_number, kind, step_id, module_id,
            alternative_id, local_reason_code, occurred_at_ms, resulting_status,
            resulting_step_index, resulting_step_elapsed_ms, resulting_updated_at_ms,
            resulting_ended_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [event.id, event.routineSessionId, event.sequenceNumber, event.kind, event.stepId ?? null,
            event.moduleId ?? null, event.alternativeId ?? null, event.localReason ?? null,
            event.occurredAtMilliseconds, checkpoint.status, checkpoint.currentStepIndex,
            checkpoint.stepElapsedMilliseconds, checkpoint.updatedAtMilliseconds,
            checkpoint.endedAtMilliseconds ?? null],
        );
        await transaction.runAsync(
          `UPDATE routine_sessions SET status = ?, current_step_index = ?, step_elapsed_ms = ?,
            started_at_ms = CASE WHEN ? = 'started' THEN ? ELSE started_at_ms END,
            updated_at_ms = ?, ended_at_ms = ? WHERE id = ?`,
          [checkpoint.status, checkpoint.currentStepIndex, checkpoint.stepElapsedMilliseconds,
            event.kind, event.occurredAtMilliseconds, checkpoint.updatedAtMilliseconds,
            checkpoint.endedAtMilliseconds ?? null, event.routineSessionId],
        );
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return writeFailure(error);
    }
  }

  async loadRoutineEvents(id: RoutineSessionId): Promise<PersistenceResult<readonly RoutineEvent[]>> {
    try {
      const sessionRow = await this.database.getFirstAsync<SessionRow>(
        'SELECT * FROM routine_sessions WHERE id = ?',
        [id],
      );
      if (sessionRow === null) return { ok: false, error: { code: 'recordNotFound' } };
      const rows = await this.database.getAllAsync<EventRow>(
        'SELECT * FROM routine_events WHERE routine_session_id = ? ORDER BY sequence_number',
        [id],
      );
      this.validateAudit(this.sessionFromRow(sessionRow), rows);
      return { ok: true, value: Object.freeze(rows.map((row) => this.eventFromRow(row))) };
    } catch (error) {
      return this.readFailure(error);
    }
  }

  async submitFeedback(submission: FeedbackSubmission): Promise<PersistenceResult<void>> {
    const validated = createFeedbackSubmission(submission);
    if (!validated.ok) return validateFailure();
    try {
      await this.database.withExclusiveTransactionAsync(async (transaction) => {
        const existing = await transaction.getFirstAsync<FeedbackRow>(
          'SELECT * FROM feedback_submissions WHERE id = ?',
          [submission.id],
        );
        if (existing !== null) {
          const responses = await transaction.getAllAsync<AreaFeedbackRow>(
            'SELECT * FROM area_feedback WHERE feedback_submission_id = ? ORDER BY area, id',
            [submission.id],
          );
          if (this.feedbackMatches(existing, responses, submission)) return;
          throw new RepositoryAbort({ code: 'conflictingWrite' });
        }
        const session = await transaction.getFirstAsync<SessionRow>(
          'SELECT * FROM routine_sessions WHERE id = ?',
          [submission.routineSessionId],
        );
        if (session === null) throw new RepositoryAbort({ code: 'recordNotFound' });
        if (
          !['completed', 'stopped', 'safetyStopped'].includes(session.status) ||
          session.ended_at_ms === null ||
          submission.submittedAtMilliseconds < session.ended_at_ms
        ) throw new RepositoryAbort({ code: 'conflictingWrite' });
        const snapshot = createOpaqueRoutineSnapshot({
          json: session.routine_snapshot_json,
          checksum: session.snapshot_checksum,
          includedAreas: this.includedAreas(session.routine_snapshot_json),
        });
        if (!snapshot.ok || submission.responses.some(({ area }) => !snapshot.value.includedAreas.includes(area))) {
          throw new RepositoryAbort({ code: 'constraintViolation', constraint: 'relationship' });
        }
        await transaction.runAsync(
          `INSERT INTO feedback_submissions(id, routine_session_id, submitted_at_ms, local_day, time_zone_id, calendar_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [submission.id, submission.routineSessionId, submission.submittedAtMilliseconds,
            submission.dayContext.localDay, submission.dayContext.timeZoneId, submission.dayContext.calendarId],
        );
        for (const response of submission.responses) {
          await transaction.runAsync(
            `INSERT INTO area_feedback(id, feedback_submission_id, area, response, submitted_at_ms,
              local_day, time_zone_id, calendar_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [response.id, submission.id, response.area, response.response,
              submission.submittedAtMilliseconds, submission.dayContext.localDay,
              submission.dayContext.timeZoneId, submission.dayContext.calendarId],
          );
        }
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return writeFailure(error);
    }
  }

  async hasFeedbackForRoutine(id: RoutineSessionId): Promise<PersistenceResult<boolean>> {
    try {
      const row = await this.database.getFirstAsync<{ id: string }>(
        'SELECT id FROM feedback_submissions WHERE routine_session_id = ? LIMIT 1',
        [id],
      );
      return { ok: true, value: row !== null };
    } catch (error) {
      return this.readFailure(error);
    }
  }

  private async count(executor: SqliteExecutor, sql: string, parameters: readonly SqlValue[] = []): Promise<number> {
    const row = await executor.getFirstAsync<{ count: number }>(sql, parameters);
    return row?.count ?? falseInteger;
  }

  private pauseFromRow(row: PauseRow): PauseTodayEvent {
    const id = parsePauseTodayEventId(row.id);
    const checkInId = parseCheckInId(row.check_in_id);
    const localDay = parseLocalDay(row.local_day);
    const context = !localDay.ok ? undefined : createLocalDayContext({
      localDay: localDay.value,
      timeZoneId: row.time_zone_id,
      calendarId: row.calendar_id,
    });
    if (!id.ok || !checkInId.ok || context === undefined || !context.ok) {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    const result = createPauseTodayEvent({
      id: id.value,
      checkInId: checkInId.value,
      chosenAtMilliseconds: row.chosen_at_ms,
      dayContext: context.value,
    });
    if (!result.ok) throw new RepositoryAbort({ code: 'corruptedStore' });
    return result.value;
  }

  private sessionFromRow(row: SessionRow): RoutineSession {
    const id = parseRoutineSessionId(row.id);
    const decisionId = parseSelectionDecisionId(row.decision_id);
    const checkInId = parseCheckInId(row.check_in_id);
    const localDay = parseLocalDay(row.local_day);
    const status = parseRoutineStatus(row.status);
    const areas = this.includedAreas(row.routine_snapshot_json);
    if (!id.ok || !decisionId.ok || !checkInId.ok || !localDay.ok || status === undefined) {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    const result = createRoutineSession({
      id: id.value,
      decisionId: decisionId.value,
      checkInId: checkInId.value,
      status,
      snapshot: { json: row.routine_snapshot_json, checksum: row.snapshot_checksum, includedAreas: areas },
      currentStepIndex: row.current_step_index,
      stepElapsedMilliseconds: row.step_elapsed_ms,
      startedAtMilliseconds: row.started_at_ms ?? undefined,
      updatedAtMilliseconds: row.updated_at_ms,
      endedAtMilliseconds: row.ended_at_ms ?? undefined,
      dayContext: { localDay: localDay.value, timeZoneId: row.time_zone_id, calendarId: row.calendar_id },
    });
    if (!result.ok) throw new RepositoryAbort({ code: 'corruptedStore' });
    return result.value;
  }

  private eventFromRow(row: EventRow): RoutineEvent {
    const id = parseRoutineEventId(row.id);
    const sessionId = parseRoutineSessionId(row.routine_session_id);
    const kind = oneOf(row.kind, routineEventKinds);
    const reason = row.local_reason_code === null ? undefined : oneOf(row.local_reason_code, routineEventReasons);
    if (!id.ok || !sessionId.ok || kind === undefined || (row.local_reason_code !== null && reason === undefined)) {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    const result = createRoutineEvent({
      id: id.value,
      routineSessionId: sessionId.value,
      sequenceNumber: row.sequence_number,
      kind,
      stepId: row.step_id ?? undefined,
      moduleId: row.module_id ?? undefined,
      alternativeId: row.alternative_id ?? undefined,
      localReason: reason,
      occurredAtMilliseconds: row.occurred_at_ms,
    });
    if (!result.ok) throw new RepositoryAbort({ code: 'corruptedStore' });
    return result.value;
  }

  private includedAreas(json: string): readonly BodyArea[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    if (typeof parsed !== 'object' || parsed === null || !('includedAreas' in parsed) || !Array.isArray(parsed.includedAreas)) {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    const areas = parsed.includedAreas;
    if (areas.some((area) => typeof area !== 'string' || !bodyAreas.includes(area as BodyArea))) {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    return areas as readonly BodyArea[];
  }

  private checkpointFromRow(row: EventRow): RoutineCheckpoint {
    const status = parseRoutineStatus(row.resulting_status);
    if (status === undefined) throw new RepositoryAbort({ code: 'corruptedStore' });
    const result = createRoutineCheckpoint({
      status,
      currentStepIndex: row.resulting_step_index,
      stepElapsedMilliseconds: row.resulting_step_elapsed_ms,
      updatedAtMilliseconds: row.resulting_updated_at_ms,
      endedAtMilliseconds: row.resulting_ended_at_ms ?? undefined,
    });
    if (!result.ok) throw new RepositoryAbort({ code: 'corruptedStore' });
    return result.value;
  }

  private validateAudit(session: RoutineSession, rows: readonly EventRow[]): void {
    if (rows.length === falseInteger && session.status !== 'prepared') {
      throw new RepositoryAbort({ code: 'corruptedStore' });
    }
    let status: RoutineStatus = 'prepared';
    let startedAt: number | undefined;
    let priorUpdatedAt: number | undefined;
    let lastCheckpoint: RoutineCheckpoint | undefined;
    for (const [index, row] of rows.entries()) {
      const event = this.eventFromRow(row);
      const checkpoint = this.checkpointFromRow(row);
      if (
        event.sequenceNumber !== index + firstSequenceNumber ||
        !isValidRoutineTransition(status, event.kind, checkpoint.status) ||
        checkpoint.updatedAtMilliseconds < event.occurredAtMilliseconds ||
        (priorUpdatedAt !== undefined && checkpoint.updatedAtMilliseconds < priorUpdatedAt)
      ) throw new RepositoryAbort({ code: 'corruptedStore' });
      if (event.kind === 'started') startedAt = event.occurredAtMilliseconds;
      status = checkpoint.status;
      priorUpdatedAt = checkpoint.updatedAtMilliseconds;
      lastCheckpoint = checkpoint;
    }
    if (lastCheckpoint === undefined) return;
    if (
      status !== session.status ||
      startedAt !== session.startedAtMilliseconds ||
      lastCheckpoint.currentStepIndex !== session.currentStepIndex ||
      lastCheckpoint.stepElapsedMilliseconds !== session.stepElapsedMilliseconds ||
      lastCheckpoint.updatedAtMilliseconds !== session.updatedAtMilliseconds ||
      lastCheckpoint.endedAtMilliseconds !== session.endedAtMilliseconds
    ) throw new RepositoryAbort({ code: 'corruptedStore' });
  }

  private eventRowMatches(row: EventRow, event: RoutineEvent, checkpoint: RoutineCheckpoint): boolean {
    return row.routine_session_id === event.routineSessionId &&
      row.sequence_number === event.sequenceNumber && row.kind === event.kind &&
      (row.step_id ?? undefined) === event.stepId && (row.module_id ?? undefined) === event.moduleId &&
      (row.alternative_id ?? undefined) === event.alternativeId &&
      (row.local_reason_code ?? undefined) === event.localReason &&
      row.occurred_at_ms === event.occurredAtMilliseconds && row.resulting_status === checkpoint.status &&
      row.resulting_step_index === checkpoint.currentStepIndex &&
      row.resulting_step_elapsed_ms === checkpoint.stepElapsedMilliseconds &&
      row.resulting_updated_at_ms === checkpoint.updatedAtMilliseconds &&
      (row.resulting_ended_at_ms ?? undefined) === checkpoint.endedAtMilliseconds;
  }

  private feedbackMatches(
    row: FeedbackRow,
    responses: readonly AreaFeedbackRow[],
    submission: FeedbackSubmission,
  ): boolean {
    const expected = submission.responses.map(({ id, area, response }) => `${id}|${area}|${response}`).sort();
    const actual = responses.map(({ id, area, response }) => `${id}|${area}|${response}`).sort();
    return row.routine_session_id === submission.routineSessionId &&
      row.submitted_at_ms === submission.submittedAtMilliseconds &&
      sameDayContext(row, submission.dayContext) && JSON.stringify(actual) === JSON.stringify(expected) &&
      responses.every((response) => response.submitted_at_ms === submission.submittedAtMilliseconds &&
        sameDayContext(response, submission.dayContext));
  }

  private readFailure<Value>(error: unknown): PersistenceResult<Value> {
    return error instanceof RepositoryAbort
      ? { ok: false, error: error.persistenceError }
      : { ok: false, error: { code: 'readFailed' } };
  }
}
