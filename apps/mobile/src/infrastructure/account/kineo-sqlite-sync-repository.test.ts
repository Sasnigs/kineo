/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import type { PendingMutation } from '../../core/account/sync-contract';
import { migrateKineoDatabase } from '../persistence/kineo-schema';
import { KineoSqliteStore } from '../persistence/kineo-sqlite-store';
import { NodeSqliteTestDatabase } from '../persistence/testing/node-sqlite-test-database';
import { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';

const accountId = '10000000-0000-4000-8000-000000000001';
const otherAccountId = '10000000-0000-4000-8000-000000000002';
const installationId = '20000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;
const mutation: PendingMutation = {
  mutationId: '30000000-0000-4000-8000-000000000001',
  accountId,
  installationId,
  historyEpoch: 1,
  createdAtMilliseconds: nowMilliseconds,
  command: { kind: 'resetHistory' },
};
const checkInId = '40000000-0000-4000-8000-000000000001';
const entryId = '50000000-0000-4000-8000-000000000001';
const safetyEventId = '60000000-0000-4000-8000-000000000001';

async function fixture() {
  const database = new NodeSqliteTestDatabase();
  await migrateKineoDatabase(database, nowMilliseconds);
  const repository = new KineoSqliteSyncRepository(
    database,
    accountId,
    installationId,
  );
  await repository.initialize(nowMilliseconds);
  return { database, repository };
}

describe('KineoSqliteSyncRepository', () => {
  it('binds one account and rejects a different owner', async () => {
    const { database } = await fixture();
    const other = new KineoSqliteSyncRepository(
      database,
      otherAccountId,
      installationId,
    );
    await expect(other.initialize(nowMilliseconds)).resolves.toEqual({
      ok: false,
      error: { code: 'localPersistence' },
    });
    await database.closeAsync();
  });

  it('round-trips valid outbox mutations and rejects identifier collisions', async () => {
    const { database, repository } = await fixture();
    await expect(repository.enqueue(mutation)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(repository.pendingMutations()).resolves.toEqual({
      ok: true,
      value: [mutation],
    });
    await expect(repository.enqueue({
      ...mutation,
      command: {
        kind: 'startRoutine',
        decisionId: 'decision',
        decision: {},
        routine: {},
      },
    })).resolves.toEqual({
      ok: false,
      error: { code: 'localPersistence' },
    });
    await database.closeAsync();
  });

  it('applies bootstrap state, legal acceptance, and cursor atomically', async () => {
    const { database, repository } = await fixture();
    await expect(repository.applyBootstrapPage({
      account: {
        accountId,
        status: 'active',
        historyEpoch: 1,
        legalAcceptances: [{
          documentKind: 'privacyPolicy',
          documentVersion: '2026-09-02',
          locale: 'en-US',
          acceptedAtMilliseconds: nowMilliseconds,
        }],
      },
      changes: [{
        cursor: '12',
        entityKind: 'profile',
        entityId: accountId,
        operation: 'upsert',
        payload: {
          adultAcknowledged: false,
          weeklyGoalDays: 3,
          telemetryChoice: 'notOffered',
          createdAtMilliseconds: nowMilliseconds,
          updatedAtMilliseconds: nowMilliseconds,
        },
      }],
      nextCursor: '12',
      hasMore: false,
    })).resolves.toEqual({ ok: true, value: undefined });
    await expect(repository.loadCursor()).resolves.toEqual({
      ok: true,
      value: '12',
    });
    const loaded = await repository.loadAccount();
    expect(loaded.ok && loaded.value?.legalAcceptances).toHaveLength(1);
    await database.closeAsync();
  });

  it('marks conflicts and acknowledges idempotent success', async () => {
    const { database, repository } = await fixture();
    await repository.enqueue(mutation);
    await repository.applySyncPage({
      accountStatus: 'active', historyEpoch: 1, changes: [], hasMore: false,
      dispositions: [{
        mutationId: mutation.mutationId,
        kind: 'conflict',
        authoritativeVersion: 2,
      }],
    }, [mutation]);
    await expect(repository.pendingMutationCount()).resolves.toEqual({
      ok: true,
      value: 0,
    });
    await database.closeAsync();
  });

  it('projects hydrated profile, check-in, and attention state locally', async () => {
    const { database, repository } = await fixture();
    const dayContext = {
      localDay: '2026-09-02',
      timeZoneId: 'America/Chicago',
      calendarId: 'gregorian',
    };
    const checkIn = {
      id: checkInId,
      status: 'completed',
      kind: 'normal',
      primaryArea: 'neck',
      startedAtMilliseconds: nowMilliseconds,
      completedAtMilliseconds: nowMilliseconds,
      dayContext,
      entries: [{
        id: entryId,
        area: 'neck',
        role: 'primary',
        changeReport: 'worse',
        movementComfort: 'limited',
        conditionalSafetyAnswer: 'notSure',
        submittedAtMilliseconds: nowMilliseconds,
      }],
    };
    await expect(repository.applyBootstrapPage({
      account: {
        accountId,
        status: 'active',
        historyEpoch: 1,
        legalAcceptances: [],
      },
      changes: [
        {
          cursor: '1',
          entityKind: 'profile',
          entityId: accountId,
          operation: 'upsert',
          payload: {
            onboardingCompletedAtMilliseconds: nowMilliseconds,
            adultAcknowledged: true,
            safetyBoundaryVersion: 'safety-v1',
            safetyAcknowledgedAtMilliseconds: nowMilliseconds,
            primaryArea: 'neck',
            weeklyGoalDays: 3,
            telemetryChoice: 'notOffered',
            createdAtMilliseconds: nowMilliseconds,
            updatedAtMilliseconds: nowMilliseconds,
          },
        },
        {
          cursor: '2',
          entityKind: 'checkIn',
          entityId: checkInId,
          operation: 'upsert',
          payload: checkIn,
        },
        {
          cursor: '3',
          entityKind: 'safetyEvent',
          entityId: safetyEventId,
          operation: 'upsert',
          payload: {
            id: safetyEventId,
            area: 'neck',
            kind: 'attentionEntered',
            sourceCheckInEntryId: entryId,
            occurredAtMilliseconds: nowMilliseconds,
            dayContext,
            statusAfter: 'attentionRequired',
          },
        },
      ],
      nextCursor: '3',
      hasMore: false,
    })).resolves.toEqual({ ok: true, value: undefined });

    const store = new KineoSqliteStore(database);
    const profile = await store.loadProfileState();
    const loadedCheckIn = await store.loadCheckIn(checkInId as never);
    const attention = await store.loadAttentionStates();
    expect(profile.ok && profile.value?.profile.primaryArea).toBe('neck');
    expect(loadedCheckIn.ok && loadedCheckIn.value?.entries).toHaveLength(1);
    expect(attention.ok && attention.value).toEqual([
      { area: 'neck', updatedAtMilliseconds: nowMilliseconds },
    ]);
    await database.closeAsync();
  });

  it('advances the reset epoch and removes stale offline mutations', async () => {
    const { database, repository } = await fixture();
    await repository.enqueue(mutation);
    await expect(repository.resetForHistoryEpoch(2)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(repository.pendingMutations()).resolves.toEqual({
      ok: true,
      value: [],
    });
    const account = await repository.loadAccount();
    expect(account.ok && account.value?.historyEpoch).toBe(2);
    await database.closeAsync();
  });
});
