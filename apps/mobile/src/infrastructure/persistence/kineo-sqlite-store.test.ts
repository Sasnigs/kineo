/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import {
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
} from '../../core/domain/selection-domain';
import { parseCatalogVersion } from '../../core/content/catalog-primitives';
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
const safetyBoundaryVersion = 'prototype-safety-v1';
const timeZoneId = 'America/Chicago';
const calendarId = 'gregorian';
const failedSafetyInsertFragment = 'INSERT INTO safety_events';

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
