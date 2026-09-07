/** @jest-environment node */
import { describe, expect, it } from '@jest/globals';

import type { PendingMutation } from '../../core/account/sync-contract';
import { createProfileState, defaultWeeklyGoalDays } from '../../core/persistence/persistence-domain';
import { migrateKineoDatabase } from '../persistence/kineo-schema';
import { KineoSqliteStore } from '../persistence/kineo-sqlite-store';
import { NodeSqliteTestDatabase } from '../persistence/testing/node-sqlite-test-database';
import { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';
import { KineoSqliteAccountWriter } from './kineo-sqlite-account-writer';

const accountId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;
const profile = createProfileState({
  profile: {
    adultAcknowledged: true, weeklyGoalDays: defaultWeeklyGoalDays,
    telemetryChoice: 'notOffered', createdAtMilliseconds: nowMilliseconds,
    updatedAtMilliseconds: nowMilliseconds,
  },
  reminderSettings: { enabled: false, updatedAtMilliseconds: nowMilliseconds },
});
if (!profile.ok) throw new Error('Invalid account writer fixture');
const state = profile.value;
const mutation: PendingMutation = {
  mutationId: '30000000-0000-4000-8000-000000000001', accountId, installationId,
  historyEpoch: 1, createdAtMilliseconds: nowMilliseconds,
  command: { kind: 'saveProfile', expectedVersion: 0, profile: state.profile },
};

async function fixture() {
  const database = new NodeSqliteTestDatabase();
  expect((await migrateKineoDatabase(database, nowMilliseconds)).ok).toBe(true);
  const outbox = new KineoSqliteSyncRepository(database, accountId, installationId);
  expect((await outbox.initialize(nowMilliseconds)).ok).toBe(true);
  const writer = new KineoSqliteAccountWriter(database, accountId, installationId,
    async () => ({ ok: true, value: undefined }));
  return { database, outbox, writer, store: new KineoSqliteStore(database) };
}

describe('atomic account writes', () => {
  it('rolls back both values if protection becomes unavailable before commit', async () => {
    const { database, outbox, store } = await fixture();
    let initialCheck = true;
    const writer = new KineoSqliteAccountWriter(database, accountId, installationId, async () => {
      if (initialCheck) { initialCheck = false; return { ok: true, value: undefined }; }
      return { ok: false, error: { code: 'protectedDataUnavailable' } };
    });
    try {
      await expect(writer.commit(mutation, (local) => local.saveProfileState(state)))
        .resolves.toEqual({ ok: false, error: { code: 'protectedDataUnavailable' } });
      await expect(store.loadProfileState()).resolves.toEqual({ ok: true, value: undefined });
      await expect(outbox.pendingMutations()).resolves.toEqual({ ok: true, value: [] });
    } finally { await database.closeAsync(); }
  });

  it('rejects a stale history epoch before any local product change', async () => {
    const { database, outbox, writer, store } = await fixture();
    try {
      expect((await outbox.resetForHistoryEpoch(2)).ok).toBe(true);
      await expect(writer.commit(mutation, (local) => local.saveProfileState(state)))
        .resolves.toEqual({ ok: false, error: { code: 'conflictingWrite' } });
      await expect(store.loadProfileState()).resolves.toEqual({ ok: true, value: undefined });
      await expect(outbox.pendingMutations()).resolves.toEqual({ ok: true, value: [] });
    } finally { await database.closeAsync(); }
  });

  it('rolls back a product write when saving its sync intent fails, then permits retry', async () => {
    const { database, outbox, writer, store } = await fixture();
    try {
      database.failNextStatementContaining('INSERT INTO sync_outbox');
      await expect(writer.commit(mutation, (local) => local.saveProfileState(state)))
        .resolves.toEqual({ ok: false, error: { code: 'writeFailed' } });
      await expect(store.loadProfileState()).resolves.toEqual({ ok: true, value: undefined });
      await expect(outbox.pendingMutations()).resolves.toEqual({ ok: true, value: [] });

      await expect(writer.commit(mutation, (local) => local.saveProfileState(state)))
        .resolves.toEqual({ ok: true, value: undefined });
      await expect(store.loadProfileState()).resolves.toEqual({ ok: true, value: state });
      await expect(outbox.pendingMutations()).resolves.toEqual({ ok: true, value: [mutation] });
    } finally { await database.closeAsync(); }
  });
});
