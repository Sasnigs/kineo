/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import { KineoSyncModule } from '../../application/account/kineo-sync-module';
import { buildAuthoritativePlan } from '../../core/account/authoritative-plan';
import type { PendingMutation, SyncCommand } from '../../core/account/sync-contract';
import {
  parseCheckInEntryId,
  parseCheckInId,
} from '../../core/domain/selection-domain';
import {
  parseLocalDay,
  type CheckIn,
} from '../../core/persistence/persistence-domain';
import {
  encodeRoutineSnapshot,
  type RoutineSession,
} from '../../core/persistence/routine-persistence-domain';
import { migrateKineoDatabase } from '../persistence/kineo-schema';
import { KineoSqliteStore } from '../persistence/kineo-sqlite-store';
import { NodeSqliteTestDatabase } from '../persistence/testing/node-sqlite-test-database';
import { DevelopmentSyncTransport } from './development-account-services';
import { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';

const accountId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const submitMutationId = '30000000-0000-4000-8000-000000000001';
const startMutationId = '30000000-0000-4000-8000-000000000002';
const attentionMutationId = '30000000-0000-4000-8000-000000000003';
const correctionMutationId = '30000000-0000-4000-8000-000000000004';
const checkInId = '40000000-0000-4000-8000-000000000001';
const correctionCheckInId = '40000000-0000-4000-8000-000000000002';
const checkInEntryId = '50000000-0000-4000-8000-000000000001';
const correctionEntryId = '50000000-0000-4000-8000-000000000002';
const decisionId = '60000000-0000-4000-8000-000000000001';
const routineId = '70000000-0000-4000-8000-000000000001';
const attentionEventId = '80000000-0000-4000-8000-000000000001';
const correctionEventId = '80000000-0000-4000-8000-000000000002';
const nowMilliseconds = 1_788_300_000_000;
const firstHistoryEpoch = 1;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) throw new Error('Invalid development transport fixture.');
  return result.value;
}

function pendingMutation(
  mutationId: string,
  command: SyncCommand,
): PendingMutation {
  return {
    mutationId,
    accountId,
    installationId,
    historyEpoch: firstHistoryEpoch,
    createdAtMilliseconds: nowMilliseconds,
    command,
  };
}

async function fixture() {
  const database = new NodeSqliteTestDatabase();
  await migrateKineoDatabase(database, nowMilliseconds);
  const repository = new KineoSqliteSyncRepository(
    database,
    accountId,
    installationId,
  );
  const initialized = await repository.initialize(nowMilliseconds);
  if (!initialized.ok) throw new Error('Could not initialize sync fixture.');
  const transport = new DevelopmentSyncTransport(repository, accountId);
  return {
    database,
    repository,
    transport,
    sync: new KineoSyncModule(
      accountId,
      installationId,
      transport,
      repository,
    ),
    store: new KineoSqliteStore(database),
  };
}

describe('DevelopmentSyncTransport', () => {
  it('projects authoritative attention entry and correction changes', async () => {
    const { database, repository, store, sync } = await fixture();
    const dayContext = {
      localDay: required(parseLocalDay('2026-09-02')),
      timeZoneId: 'America/Chicago',
      calendarId: 'gregorian',
    };
    const attentionCheckIn: CheckIn = {
      id: required(parseCheckInId(checkInId)),
      status: 'completed',
      kind: 'normal',
      primaryArea: 'neck',
      startedAtMilliseconds: nowMilliseconds,
      completedAtMilliseconds: nowMilliseconds,
      dayContext,
      entries: [{
        id: required(parseCheckInEntryId(checkInEntryId)),
        area: 'neck',
        role: 'primary',
        changeReport: 'worse',
        movementComfort: 'limited',
        conditionalSafetyAnswer: 'yes',
        submittedAtMilliseconds: nowMilliseconds,
      }],
    };
    const attention = pendingMutation(attentionMutationId, {
      kind: 'submitCheckIn',
      checkIn: attentionCheckIn,
      decisionId,
      decisionRevision: 1,
      durationVariant: 'standard',
      attentionTransitions: [{
        id: attentionEventId,
        area: 'neck',
        kind: 'attentionEntered',
        sourceCheckInEntryId: checkInEntryId,
        occurredAtMilliseconds: nowMilliseconds,
        dayContext,
        statusAfter: 'attentionRequired',
      }],
    });
    expect(await repository.enqueue(attention)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await sync.synchronize([attention])).toMatchObject({ ok: true });

    expect(await store.loadCheckIn(attentionCheckIn.id)).toEqual({
      ok: true,
      value: attentionCheckIn,
    });
    expect(await store.loadAttentionStates()).toEqual({
      ok: true,
      value: [{ area: 'neck', updatedAtMilliseconds: nowMilliseconds }],
    });

    const correctionTimeMilliseconds = nowMilliseconds + 1;
    const correctionCheckIn: CheckIn = {
      id: required(parseCheckInId(correctionCheckInId)),
      status: 'completed',
      kind: 'attentionCorrection',
      correctionSource: {
        area: 'neck',
        triggeringEntryId: required(parseCheckInEntryId(checkInEntryId)),
      },
      primaryArea: 'neck',
      startedAtMilliseconds: correctionTimeMilliseconds,
      completedAtMilliseconds: correctionTimeMilliseconds,
      dayContext,
      entries: [{
        id: required(parseCheckInEntryId(correctionEntryId)),
        area: 'neck',
        role: 'primary',
        changeReport: 'similar',
        movementComfort: 'okay',
        submittedAtMilliseconds: correctionTimeMilliseconds,
      }],
    };
    const correction = pendingMutation(correctionMutationId, {
      kind: 'submitCheckIn',
      checkIn: correctionCheckIn,
      decisionId,
      decisionRevision: 1,
      durationVariant: 'standard',
      suppressPlan: true,
      attentionTransitions: [{
        id: correctionEventId,
        area: 'neck',
        kind: 'attentionClearedCorrection',
        sourceCheckInEntryId: correctionEntryId,
        occurredAtMilliseconds: correctionTimeMilliseconds,
        dayContext,
        statusAfter: 'normal',
        expectedAttentionUpdatedAtMilliseconds: nowMilliseconds,
      }],
    });
    expect(await repository.enqueue(correction)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await sync.synchronize([correction])).toMatchObject({ ok: true });
    expect(await store.loadCheckIn(correctionCheckIn.id)).toEqual({
      ok: true,
      value: correctionCheckIn,
    });
    expect(await store.loadAttentionStates()).toEqual({
      ok: true,
      value: [],
    });
    await database.closeAsync();
  });

  it('projects an installation-owned routine session when a routine starts', async () => {
    const { database, repository, store, sync } = await fixture();
    const checkIn: CheckIn = {
      id: required(parseCheckInId(checkInId)),
      status: 'completed',
      kind: 'normal',
      primaryArea: 'neck',
      startedAtMilliseconds: nowMilliseconds,
      completedAtMilliseconds: nowMilliseconds,
      dayContext: {
        localDay: required(parseLocalDay('2026-09-02')),
        timeZoneId: 'America/Chicago',
        calendarId: 'gregorian',
      },
      entries: [{
        id: required(parseCheckInEntryId(checkInEntryId)),
        area: 'neck',
        role: 'primary',
        changeReport: 'similar',
        movementComfort: 'okay',
        submittedAtMilliseconds: nowMilliseconds,
      }],
    };
    const approved = buildAuthoritativePlan({
      checkIn,
      decisionId: decisionId as never,
      revision: 1,
      duration: 'quick',
      attentionRequiredAreas: [],
      orderedOutcomes: [],
      createdAtMilliseconds: nowMilliseconds,
    });
    if (!approved.ok || approved.value.kind !== 'approved') {
      throw new Error('Invalid development transport plan fixture.');
    }
    const submit = pendingMutation(submitMutationId, {
      kind: 'submitCheckIn',
      checkIn,
      decisionId,
      decisionRevision: 1,
      durationVariant: 'quick',
    });
    expect(await repository.enqueue(submit)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await sync.synchronize([submit])).toMatchObject({ ok: true });

    const routine: RoutineSession = {
      id: routineId as never,
      decisionId: approved.value.decision.id,
      checkInId: checkIn.id,
      status: 'prepared',
      snapshot: encodeRoutineSnapshot({
        ...approved.value.snapshotTemplate,
        sessionId: routineId as never,
      }),
      currentStepIndex: 0,
      stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: nowMilliseconds,
      dayContext: checkIn.dayContext,
    };
    const start = pendingMutation(startMutationId, {
      kind: 'startRoutine',
      decisionId,
      decision: approved.value.decision,
      routine,
    });
    expect(await repository.enqueue(start)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await sync.synchronize([start])).toMatchObject({ ok: true });

    expect(await store.loadRoutineSession(routine.id)).toEqual({
      ok: true,
      value: routine,
    });
    expect(
      await repository.loadSynchronizedEntity('routineSession', routine.id),
    ).toMatchObject({
      ok: true,
      value: { ownerInstallationId: installationId, routine },
    });
    await database.closeAsync();
  });

  it('rejects a malformed routine start without throwing', async () => {
    const { database, transport } = await fixture();

    await expect(transport.synchronize({
      installationId,
      mutations: [{
        mutationId: startMutationId,
        installationId,
        historyEpoch: firstHistoryEpoch,
        createdAtMilliseconds: nowMilliseconds,
        command: {
          kind: 'startRoutine',
          decisionId,
          decision: {},
          routine: {},
        },
      }],
    })).resolves.toMatchObject({
      ok: true,
      value: {
        changes: [],
        dispositions: [{
          mutationId: startMutationId,
          kind: 'rejected',
          code: 'invalidCommand',
        }],
      },
    });
    await database.closeAsync();
  });

  it('rejects a malformed check-in without throwing', async () => {
    const { database, transport } = await fixture();

    await expect(transport.synchronize({
      installationId,
      mutations: [{
        mutationId: attentionMutationId,
        installationId,
        historyEpoch: firstHistoryEpoch,
        createdAtMilliseconds: nowMilliseconds,
        command: {
          kind: 'submitCheckIn',
          checkIn: {},
          decisionId,
          decisionRevision: 1,
          durationVariant: 'standard',
        },
      }],
    })).resolves.toMatchObject({
      ok: true,
      value: {
        changes: [],
        dispositions: [{
          mutationId: attentionMutationId,
          kind: 'rejected',
          code: 'invalidCommand',
        }],
      },
    });
    await database.closeAsync();
  });
});
