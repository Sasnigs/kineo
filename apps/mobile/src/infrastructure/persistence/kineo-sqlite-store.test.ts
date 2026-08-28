/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import {
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
} from '../../core/domain/selection-domain';
import {
  parseCatalogId,
  parseCatalogVersion,
  parseContentRevision,
  parseSha256Digest,
} from '../../core/content/catalog-primitives';
import { parseCompositionId } from '../../core/content/routine-composer';
import {
  parseRoutineSessionId,
  type RoutineSessionSnapshot,
} from '../../core/content/routine-session-snapshot';
import {
  createSelectionDecision,
  type SelectionDecision,
} from '../../core/persistence/decision-persistence-domain';
import {
  createCheckIn,
  createCheckInEntry,
  createLocalDayContext,
  createProfileState,
  createSafetyEvent,
  createSafetyMutation,
  defaultWeeklyGoalDays,
  parseLocalDay,
  parseSafetyEventId,
  type CheckIn,
  type ProfileState,
  type SafetyMutation,
} from '../../core/persistence/persistence-domain';
import {
  createFeedbackSubmission,
  createPauseTodayEvent,
  createRoutineEvent,
  createRoutineSession,
  encodeRoutineSnapshot,
  parseAreaFeedbackId,
  parseFeedbackSubmissionId,
  parsePauseTodayEventId,
  parseRoutineEventId,
  type RoutineSession,
} from '../../core/persistence/routine-persistence-domain';
import { KineoSqliteStore } from './kineo-sqlite-store';
import { migrateKineoDatabase } from './kineo-schema';
import { NodeSqliteTestDatabase } from './testing/node-sqlite-test-database';

const startedAtMilliseconds = 1_750_000_000_000;
const completedAtMilliseconds = startedAtMilliseconds + 1;
const safetyAtMilliseconds = completedAtMilliseconds + 1;
const checkInIdValue = '00000000-0000-0000-0000-000000000001';
const entryIdValue = '00000000-0000-0000-0000-000000000002';
const safetyEventIdValue = '00000000-0000-0000-0000-000000000003';
const secondCheckInIdValue = '00000000-0000-0000-0000-000000000004';
const secondEntryIdValue = '00000000-0000-0000-0000-000000000005';
const secondSafetyEventIdValue = '00000000-0000-0000-0000-000000000006';
const decisionIdValue = '00000000-0000-0000-0000-000000000007';
const routineSessionIdValue = '00000000-0000-0000-0000-000000000008';
const startedEventIdValue = '00000000-0000-0000-0000-000000000009';
const completedEventIdValue = '00000000-0000-0000-0000-000000000010';
const feedbackIdValue = '00000000-0000-0000-0000-000000000011';
const areaFeedbackIdValue = '00000000-0000-0000-0000-000000000012';
const compositionIdValue = '00000000-0000-0000-0000-000000000013';
const pauseEventIdValue = '00000000-0000-0000-0000-000000000014';
const safetyBoundaryVersion = 'prototype-safety-v1';
const timeZoneId = 'America/Chicago';
const calendarId = 'gregorian';
const failedSafetyInsertFragment = 'INSERT INTO safety_events';
const failedDecisionAreaInsertFragment = 'INSERT INTO decision_area_inputs';
const failedRoutineUpdateFragment = 'UPDATE routine_sessions SET';
const failedAreaFeedbackInsertFragment = 'INSERT INTO area_feedback';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A SQLite-store fixture failed validation.');
  }
  return result.value;
}

function profileState(createdAt = startedAtMilliseconds): ProfileState {
  return required(
    createProfileState({
      profile: {
        onboardingCompletedAtMilliseconds: completedAtMilliseconds,
        adultAcknowledged: true,
        safetyBoundaryVersion,
        safetyAcknowledgedAtMilliseconds: completedAtMilliseconds,
        primaryArea: 'neck',
        secondaryArea: 'lowerBack',
        weeklyGoalDays: defaultWeeklyGoalDays,
        telemetryChoice: 'notOffered',
        createdAtMilliseconds: createdAt,
        updatedAtMilliseconds: completedAtMilliseconds,
      },
      reminderSettings: {
        enabled: false,
        updatedAtMilliseconds: completedAtMilliseconds,
      },
    }),
  );
}

function checkIn(
  status: 'draft' | 'completed',
  identifier = checkInIdValue,
  entryIdentifier = entryIdValue,
  triggersAttention = false,
): CheckIn {
  const entry = required(
    createCheckInEntry({
      id: required(parseCheckInEntryId(entryIdentifier)),
      area: 'neck',
      role: 'primary',
      changeReport: triggersAttention ? 'worse' : 'similar',
      movementComfort: 'good',
      conditionalSafetyAnswer: triggersAttention ? 'yes' : undefined,
      submittedAtMilliseconds: completedAtMilliseconds,
    }),
  );
  return required(
    createCheckIn({
      id: required(parseCheckInId(identifier)),
      status,
      kind: 'normal',
      primaryArea: 'neck',
      secondaryArea: 'lowerBack',
      startedAtMilliseconds,
      completedAtMilliseconds:
        status === 'completed' ? completedAtMilliseconds : undefined,
      dayContext: required(
        createLocalDayContext({
          localDay: required(parseLocalDay('2026-08-27')),
          timeZoneId,
          calendarId,
        }),
      ),
      entries: [entry],
    }),
  );
}

function pauseEligibleCheckIn(status: 'draft' | 'completed'): CheckIn {
  const entry = required(createCheckInEntry({
    id: required(parseCheckInEntryId(entryIdValue)),
    area: 'neck',
    role: 'primary',
    changeReport: 'worse',
    movementComfort: 'good',
    conditionalSafetyAnswer: 'no',
    submittedAtMilliseconds: completedAtMilliseconds,
  }));
  return required(createCheckIn({
    id: required(parseCheckInId(checkInIdValue)),
    status,
    kind: 'normal',
    primaryArea: 'neck',
    startedAtMilliseconds,
    completedAtMilliseconds: status === 'completed' ? completedAtMilliseconds : undefined,
    dayContext: required(createLocalDayContext({
      localDay: required(parseLocalDay('2026-08-27')),
      timeZoneId,
      calendarId,
    })),
    entries: [entry],
  }));
}

function attentionMutation(
  completedCheckIn: CheckIn,
  safetyIdentifier = safetyEventIdValue,
): SafetyMutation {
  const sourceEntry = completedCheckIn.entries[0];
  if (sourceEntry === undefined) {
    throw new Error('The completed check-in needs a source entry.');
  }
  const event = required(
    createSafetyEvent({
      id: required(parseSafetyEventId(safetyIdentifier)),
      area: sourceEntry.area,
      kind: 'attentionEntered',
      sourceCheckInEntryId: sourceEntry.id,
      occurredAtMilliseconds: safetyAtMilliseconds,
      dayContext: completedCheckIn.dayContext,
    }),
  );
  return required(
    createSafetyMutation({
      event,
      statusAfter: 'attentionRequired',
    }),
  );
}

function unavailableDecision(completedCheckIn: CheckIn): SelectionDecision {
  const sourceEntry = completedCheckIn.entries[0];
  if (sourceEntry === undefined) {
    throw new Error('A decision requires its check-in entry.');
  }
  return required(
    createSelectionDecision({
      id: required(parseSelectionDecisionId(decisionIdValue)),
      checkInId: completedCheckIn.id,
      revision: 1,
      rulesVersion: 'selection-v1.0.0-prototype',
      catalogVersionRequested: required(parseCatalogVersion('0.1.0')),
      outcome: 'contentUnavailable',
      recommendedLevel: 'balanced',
      overrideDisposition: 'none',
      selectedLevel: 'balanced',
      duration: 'standard',
      validationResult: 'unavailable',
      createdAtMilliseconds: safetyAtMilliseconds,
      areaInputs: [
        {
          area: sourceEntry.area,
          role: sourceEntry.role,
          checkInEntryId: sourceEntry.id,
          baseLevel: 'balanced',
          activeUnlocked: false,
          qualifyingCount: 0,
          included: true,
        },
      ],
      reasons: [],
      notices: [],
    }),
  );
}

function selectedDecision(completedCheckIn: CheckIn): SelectionDecision {
  const sourceEntry = completedCheckIn.entries[0];
  if (sourceEntry === undefined) throw new Error('A decision requires an entry.');
  return required(createSelectionDecision({
    id: required(parseSelectionDecisionId(decisionIdValue)),
    checkInId: completedCheckIn.id,
    revision: 1,
    rulesVersion: 'selection-v1.0.0-prototype',
    catalogVersionRequested: required(parseCatalogVersion('0.1.0')),
    catalogVersionDelivered: required(parseCatalogVersion('0.1.0')),
    outcome: 'selected',
    recommendedLevel: 'gentle',
    overrideDisposition: 'none',
    selectedLevel: 'gentle',
    deliveredLevel: 'gentle',
    duration: 'quick',
    validationResult: 'exact',
    primaryTemplateId: required(parseCatalogId('routine.neck.gentle')),
    primaryTemplateRevision: required(parseContentRevision(1)),
    compositionFingerprint: required(parseSha256Digest('a'.repeat(64))),
    createdAtMilliseconds: safetyAtMilliseconds,
    areaInputs: [{
      area: sourceEntry.area,
      role: sourceEntry.role,
      checkInEntryId: sourceEntry.id,
      baseLevel: 'gentle',
      activeUnlocked: false,
      qualifyingCount: 0,
      included: true,
    }],
    reasons: [],
    notices: [],
  }));
}

function routineSnapshot(decision: SelectionDecision): RoutineSessionSnapshot {
  return {
    sessionId: required(parseRoutineSessionId(routineSessionIdValue)),
    decisionId: decision.id,
    compositionId: required(parseCompositionId(compositionIdValue)),
    catalogVersion: required(parseCatalogVersion('0.1.0')),
    rulesVersion: decision.rulesVersion,
    fingerprint: required(parseSha256Digest('a'.repeat(64))),
    selectedLevel: 'gentle',
    deliveredLevel: 'gentle',
    duration: 'quick',
    includedAreas: ['neck'],
    notices: [],
    presentedExplanationKeys: [],
    presentedExplanationParameters: [],
    items: [{} as RoutineSessionSnapshot['items'][number]],
    createdAtMilliseconds: safetyAtMilliseconds,
  };
}

function preparedRoutine(completedCheckIn: CheckIn, decision: SelectionDecision): RoutineSession {
  return required(createRoutineSession({
    id: required(parseRoutineSessionId(routineSessionIdValue)),
    decisionId: decision.id,
    checkInId: completedCheckIn.id,
    status: 'prepared',
    snapshot: encodeRoutineSnapshot(routineSnapshot(decision)),
    currentStepIndex: 0,
    stepElapsedMilliseconds: 0,
    updatedAtMilliseconds: safetyAtMilliseconds,
    dayContext: completedCheckIn.dayContext,
  }));
}

async function makeStore() {
  const database = new NodeSqliteTestDatabase();
  const migrated = await migrateKineoDatabase(
    database,
    startedAtMilliseconds,
  );
  if (!migrated.ok) {
    throw new Error('The SQLite test database failed migration.');
  }
  return { database, store: new KineoSqliteStore(database) };
}

describe('Kineo SQLite store', () => {
  it('round-trips profile state and protects its creation timestamp', async () => {
    const { database, store } = await makeStore();
    const state = profileState();

    await expect(store.saveProfileState(state)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(store.loadProfileState()).resolves.toEqual({
      ok: true,
      value: state,
    });
    await expect(
      store.saveProfileState(profileState(startedAtMilliseconds + 1)),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'constraintViolation',
        constraint: 'immutableRecord',
      },
    });
    await database.closeAsync();
  });

  it('commits a completed check-in and Attention transition atomically', async () => {
    const { database, store } = await makeStore();
    const draft = checkIn('draft');
    const completed = checkIn('completed', checkInIdValue, entryIdValue, true);
    const mutation = attentionMutation(completed);

    await store.saveCheckInDraft(draft);
    await expect(store.completeCheckIn(completed, [mutation])).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(store.loadCheckIn(completed.id)).resolves.toEqual({
      ok: true,
      value: completed,
    });
    await expect(store.loadAttentionStates()).resolves.toEqual({
      ok: true,
      value: [
        {
          area: 'neck',
          updatedAtMilliseconds: safetyAtMilliseconds,
        },
      ],
    });
    await expect(store.completeCheckIn(completed, [mutation])).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      store.completeCheckIn(completed, [
        attentionMutation(completed, secondSafetyEventIdValue),
      ]),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'conflictingWrite' },
    });
    await database.closeAsync();
  });

  it('rolls back check-in completion when the safety event write fails', async () => {
    const { database, store } = await makeStore();
    const draft = checkIn('draft', secondCheckInIdValue, secondEntryIdValue);
    const completed = checkIn(
      'completed',
      secondCheckInIdValue,
      secondEntryIdValue,
      true,
    );
    await store.saveCheckInDraft(draft);
    database.failNextStatementContaining(failedSafetyInsertFragment);

    await expect(
      store.completeCheckIn(completed, [
        attentionMutation(completed, secondSafetyEventIdValue),
      ]),
    ).resolves.toEqual({ ok: false, error: { code: 'writeFailed' } });
    await expect(store.loadCheckIn(draft.id)).resolves.toEqual({
      ok: true,
      value: draft,
    });
    await expect(store.loadAttentionStates()).resolves.toEqual({
      ok: true,
      value: [],
    });
    await database.closeAsync();
  });

  it('cannot complete a triggering check-in without its exact Attention mutation', async () => {
    const { database, store } = await makeStore();
    const draft = checkIn('draft');
    const completed = checkIn('completed', checkInIdValue, entryIdValue, true);
    await store.saveCheckInDraft(draft);

    await expect(store.completeCheckIn(completed, [])).resolves.toEqual({
      ok: false,
      error: {
        code: 'constraintViolation',
        constraint: 'domainInvariant',
      },
    });
    await expect(store.loadCheckIn(draft.id)).resolves.toEqual({
      ok: true,
      value: draft,
    });
    await database.closeAsync();
  });

  it('appends a decision only after an eligible completed check-in', async () => {
    const { database, store } = await makeStore();
    const draft = checkIn('draft');
    const completed = checkIn('completed');
    const decision = unavailableDecision(completed);
    await store.saveCheckInDraft(draft);
    await store.completeCheckIn(completed, []);

    database.failNextStatementContaining(failedDecisionAreaInsertFragment);
    await expect(store.appendSelectionDecision(decision)).resolves.toEqual({
      ok: false,
      error: { code: 'writeFailed' },
    });
    const rolledBackCount = await database.getFirstAsync<{ count: number }>(
      'SELECT count(*) AS count FROM selection_decisions',
    );
    expect(rolledBackCount?.count).toBe(0);
    await expect(store.appendSelectionDecision(decision)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    const count = await database.getFirstAsync<{ count: number }>(
      'SELECT count(*) AS count FROM selection_decisions',
    );
    expect(count?.count).toBe(1);
    await expect(store.appendSelectionDecision(decision)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      store.loadLatestSelectionDecision(completed.id),
    ).resolves.toEqual({
      ok: true,
      value: decision,
    });
    await database.closeAsync();
  });

  it('restores a routine checkpoint and accepts exact event retries', async () => {
    const { database, store } = await makeStore();
    const draft = checkIn('draft');
    const completed = checkIn('completed');
    const decision = selectedDecision(completed);
    const session = preparedRoutine(completed, decision);
    await store.saveCheckInDraft(draft);
    await store.completeCheckIn(completed, []);
    await store.appendSelectionDecision(decision);
    await expect(store.createRoutine(session)).resolves.toEqual({ ok: true, value: undefined });

    const started = required(createRoutineEvent({
      id: required(parseRoutineEventId(startedEventIdValue)),
      routineSessionId: session.id,
      sequenceNumber: 1,
      kind: 'started',
      occurredAtMilliseconds: safetyAtMilliseconds + 1,
    }));
    const checkpoint = {
      status: 'inProgress' as const,
      currentStepIndex: 0,
      stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: safetyAtMilliseconds + 1,
    };
    database.failNextStatementContaining(failedRoutineUpdateFragment);
    await expect(store.recordRoutineEvent(started, checkpoint)).resolves.toEqual({
      ok: false,
      error: { code: 'writeFailed' },
    });
    await expect(store.loadRoutineSession(session.id)).resolves.toEqual({
      ok: true,
      value: session,
    });
    await expect(store.loadRoutineEvents(session.id)).resolves.toEqual({ ok: true, value: [] });
    await expect(store.recordRoutineEvent(started, checkpoint)).resolves.toEqual({ ok: true, value: undefined });
    await expect(store.recordRoutineEvent(started, checkpoint)).resolves.toEqual({ ok: true, value: undefined });
    const restored = await store.loadNonterminalRoutine();
    expect(restored.ok && restored.value?.status).toBe('inProgress');
    await expect(store.loadRoutineEvents(session.id)).resolves.toEqual({ ok: true, value: [started] });
    await database.closeAsync();
  });

  it('records Pause Today only for the eligible completed selection', async () => {
    const { database, store } = await makeStore();
    const draft = pauseEligibleCheckIn('draft');
    const completed = pauseEligibleCheckIn('completed');
    const decision = selectedDecision(completed);
    const event = required(createPauseTodayEvent({
      id: required(parsePauseTodayEventId(pauseEventIdValue)),
      checkInId: completed.id,
      chosenAtMilliseconds: safetyAtMilliseconds + 1,
      dayContext: completed.dayContext,
    }));
    await store.saveCheckInDraft(draft);
    await store.completeCheckIn(completed, []);
    await store.appendSelectionDecision(decision);
    await expect(store.recordPauseToday(event)).resolves.toEqual({ ok: true, value: undefined });
    await expect(store.recordPauseToday(event)).resolves.toEqual({ ok: true, value: undefined });
    await expect(store.loadPauseToday(completed.dayContext.localDay)).resolves.toEqual({
      ok: true,
      value: event,
    });
    await expect(store.createRoutine(preparedRoutine(completed, decision))).resolves.toEqual({
      ok: false,
      error: { code: 'conflictingWrite' },
    });
    await database.closeAsync();
  });

  it('persists terminal feedback once and detects snapshot corruption', async () => {
    const { database, store } = await makeStore();
    const completed = checkIn('completed');
    const decision = selectedDecision(completed);
    const session = preparedRoutine(completed, decision);
    await store.saveCheckInDraft(checkIn('draft'));
    await store.completeCheckIn(completed, []);
    await store.appendSelectionDecision(decision);
    await store.createRoutine(session);
    const started = required(createRoutineEvent({
      id: required(parseRoutineEventId(startedEventIdValue)),
      routineSessionId: session.id,
      sequenceNumber: 1,
      kind: 'started',
      occurredAtMilliseconds: safetyAtMilliseconds + 1,
    }));
    await store.recordRoutineEvent(started, {
      status: 'inProgress', currentStepIndex: 0, stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: safetyAtMilliseconds + 1,
    });
    const completedEvent = required(createRoutineEvent({
      id: required(parseRoutineEventId(completedEventIdValue)),
      routineSessionId: session.id,
      sequenceNumber: 2,
      kind: 'completed',
      occurredAtMilliseconds: safetyAtMilliseconds + 2,
    }));
    await store.recordRoutineEvent(completedEvent, {
      status: 'completed', currentStepIndex: 1, stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: safetyAtMilliseconds + 2,
      endedAtMilliseconds: safetyAtMilliseconds + 2,
    });
    const feedback = required(createFeedbackSubmission({
      id: required(parseFeedbackSubmissionId(feedbackIdValue)),
      routineSessionId: session.id,
      responses: [{
        id: required(parseAreaFeedbackId(areaFeedbackIdValue)),
        area: 'neck',
        response: 'better',
      }],
      submittedAtMilliseconds: safetyAtMilliseconds + 3,
      dayContext: completed.dayContext,
    }));
    database.failNextStatementContaining(failedAreaFeedbackInsertFragment);
    await expect(store.submitFeedback(feedback)).resolves.toEqual({
      ok: false,
      error: { code: 'writeFailed' },
    });
    const rolledBackFeedbackCount = await database.getFirstAsync<{ count: number }>(
      'SELECT count(*) AS count FROM feedback_submissions',
    );
    expect(rolledBackFeedbackCount?.count).toBe(0);
    await expect(store.submitFeedback(feedback)).resolves.toEqual({ ok: true, value: undefined });
    await expect(store.submitFeedback(feedback)).resolves.toEqual({ ok: true, value: undefined });
    const feedbackCount = await database.getFirstAsync<{ count: number }>(
      'SELECT count(*) AS count FROM feedback_submissions',
    );
    expect(feedbackCount?.count).toBe(1);

    await database.runAsync(
      'UPDATE routine_sessions SET routine_snapshot_json = ? WHERE id = ?',
      ['{}', session.id],
    );
    await expect(store.loadRoutineSession(session.id)).resolves.toEqual({
      ok: false,
      error: { code: 'corruptedStore' },
    });
    await database.closeAsync();
  });

  it('resets history while retaining profile and current Attention', async () => {
    const { database, store } = await makeStore();
    const state = profileState();
    const draft = checkIn('draft');
    const completed = checkIn('completed', checkInIdValue, entryIdValue, true);
    await store.saveProfileState(state);
    await store.saveCheckInDraft(draft);
    await store.completeCheckIn(completed, [attentionMutation(completed)]);

    await expect(store.resetHistory()).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(store.loadProfileState()).resolves.toEqual({
      ok: true,
      value: state,
    });
    await expect(store.loadAttentionStates()).resolves.toEqual({
      ok: true,
      value: [
        {
          area: 'neck',
          updatedAtMilliseconds: safetyAtMilliseconds,
        },
      ],
    });
    await expect(store.loadCheckIn(completed.id)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await database.closeAsync();
  });
});
