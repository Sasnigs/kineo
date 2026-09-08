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
const checkInId = '40000000-0000-4000-8000-000000000001';
const checkInEntryId = '50000000-0000-4000-8000-000000000001';
const decisionId = '60000000-0000-4000-8000-000000000001';
const routineId = '70000000-0000-4000-8000-000000000001';
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

describe('DevelopmentSyncTransport', () => {
  it('projects an installation-owned routine session when a routine starts', async () => {
    const database = new NodeSqliteTestDatabase();
    await migrateKineoDatabase(database, nowMilliseconds);
    const repository = new KineoSqliteSyncRepository(
      database,
      accountId,
      installationId,
    );
    expect(await repository.initialize(nowMilliseconds)).toEqual({
      ok: true,
      value: undefined,
    });
    const sync = new KineoSyncModule(
      accountId,
      installationId,
      new DevelopmentSyncTransport(repository, accountId),
      repository,
    );
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

    const store = new KineoSqliteStore(database);
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
    const database = new NodeSqliteTestDatabase();
    await migrateKineoDatabase(database, nowMilliseconds);
    const repository = new KineoSqliteSyncRepository(
      database,
      accountId,
      installationId,
    );
    expect(await repository.initialize(nowMilliseconds)).toEqual({
      ok: true,
      value: undefined,
    });
    const transport = new DevelopmentSyncTransport(repository, accountId);

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
});
