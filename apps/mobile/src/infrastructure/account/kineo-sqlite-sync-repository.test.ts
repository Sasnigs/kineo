/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import type { PendingMutation } from '../../core/account/sync-contract';
import { migrateKineoDatabase } from '../persistence/kineo-schema';
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
      command: { kind: 'startRoutine', decisionId: 'decision' },
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
        payload: { weeklyGoalDays: 3 },
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
