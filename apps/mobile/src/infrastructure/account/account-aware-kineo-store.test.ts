import { describe, expect, it } from '@jest/globals';

import type { PendingMutation } from '../../core/account/sync-contract';
import type {
  SyncLocalRepository,
  SyncModule,
  SyncOutbox,
  SyncResult,
} from '../../core/account/sync-module';
import type { KineoPersistence } from '../../core/persistence/kineo-store';
import { AccountAwareKineoStore } from './account-aware-kineo-store';
import type { AccountLocalWriter } from './kineo-sqlite-account-writer';

const accountId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const mutationId = '30000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;
// These tests isolate server-result mapping; real commit/rollback behavior is
// exercised with SQLite in kineo-sqlite-account-writer.test.ts.
const successfulWriter: AccountLocalWriter = {
  commit: async () => ({ ok: true, value: undefined }),
};

class FakeRepository implements SyncLocalRepository, SyncOutbox {
  async isHydrated() { return { ok: true as const, value: true }; }
  pending: PendingMutation[] = [];
  synchronizedEntity: unknown = { ownerInstallationId: installationId };
  async loadAccount() {
    return {
      ok: true as const,
      value: {
        accountId,
        status: 'active' as const,
        historyEpoch: 1,
        legalAcceptances: [],
      },
    };
  }
  async loadCursor() { return { ok: true as const, value: undefined }; }
  async applyBootstrapPage() { return { ok: true as const, value: undefined }; }
  async applySyncPage() { return { ok: true as const, value: undefined }; }
  async pendingMutationCount() {
    return { ok: true as const, value: this.pending.length };
  }
  async loadSynchronizedEntity() {
    return { ok: true as const, value: this.synchronizedEntity };
  }
  async enqueue(mutation: PendingMutation) {
    this.pending.push(mutation);
    return { ok: true as const, value: undefined };
  }
  async pendingMutations() {
    return { ok: true as const, value: this.pending };
  }
  async discardPendingMutations() {
    this.pending = [];
    return { ok: true as const, value: undefined };
  }
}

class FakeSync implements SyncModule {
  result: 'success' | Extract<SyncResult<never>, { ok: false }>['error']['code'] = 'success';
  async bootstrap() {
    return { ok: false as const, error: { code: 'offline' as const } };
  }
  async synchronize() {
    if (this.result !== 'success') {
      return {
        ok: false as const,
        error: { code: this.result },
      };
    }
    return {
      ok: true as const,
      value: {
        account: {
          accountId,
          status: 'active' as const,
          historyEpoch: 1,
          legalAcceptances: [],
        },
        pendingMutationCount: 0,
      },
    };
  }
}

describe('AccountAwareKineoStore', () => {
  it('does not change account-wide preferences locally while offline', async () => {
    const sync = new FakeSync();
    sync.result = 'offline';
    let writes = 0;
    const store = new AccountAwareKineoStore({} as KineoPersistence,
      accountId, installationId, sync, new FakeRepository(), () => mutationId,
      () => nowMilliseconds, false, {
        async commit() { writes += 1; return { ok: true, value: undefined }; },
      });
    expect(await store.saveProfileState({ profile: { adultAcknowledged: true,
      weeklyGoalDays: 3, telemetryChoice: 'notOffered', createdAtMilliseconds: nowMilliseconds,
      updatedAtMilliseconds: nowMilliseconds } })).toEqual({ ok: false, error: { code: 'writeFailed' } });
    expect(writes).toBe(0);
  });

  it('cannot queue offline playback for another installation’s active routine', async () => {
    const sync = new FakeSync();
    sync.result = 'offline';
    const repository = new FakeRepository();
    repository.synchronizedEntity = { ownerInstallationId: 'another-installation' };
    let writes = 0;
    const store = new AccountAwareKineoStore({} as KineoPersistence,
      accountId, installationId, sync, repository, () => mutationId,
      () => nowMilliseconds, false, {
        async commit() { writes += 1; return { ok: true, value: undefined }; },
      });
    expect(await store.recordRoutineEvent({ routineSessionId: 'routine' } as never,
      { status: 'inProgress', currentStepIndex: 0, stepElapsedMilliseconds: 0,
        updatedAtMilliseconds: nowMilliseconds })).toEqual({ ok: false, error: { code: 'conflictingWrite' } });
    expect(writes).toBe(0);
  });

  it('retains remote history but never resumes another installation’s active playback', async () => {
    const repository = new FakeRepository();
    repository.synchronizedEntity = { ownerInstallationId: 'another-installation' };
    let status = 'inProgress';
    const base = {
      async loadNonterminalRoutine() { return { ok: true, value: { id: 'routine', status } }; },
      async loadRoutineSession() { return { ok: true, value: { id: 'routine', status } }; },
    } as unknown as KineoPersistence;
    const store = new AccountAwareKineoStore(base, accountId, installationId,
      new FakeSync(), repository, () => mutationId, () => nowMilliseconds, false, successfulWriter);
    expect(await store.loadNonterminalRoutine()).toEqual({ ok: true, value: undefined });
    expect(await store.loadRoutineSession('routine' as never))
      .toEqual({ ok: false, error: { code: 'conflictingWrite' } });
    status = 'stopped';
    expect(await store.loadRoutineSession('routine' as never))
      .toEqual({ ok: true, value: { id: 'routine', status: 'stopped' } });
  });

  it.each(['installationRevoked', 'authenticationRequired', 'localPersistence', 'conflict'] as const)(
    'does not disguise %s as a successful offline write', async (errorCode) => {
      const sync = new FakeSync();
      sync.result = errorCode;
      const store = new AccountAwareKineoStore(
        { recordRoutineEvent: async () => ({ ok: true, value: undefined }) } as unknown as KineoPersistence,
        accountId, installationId, sync, new FakeRepository(),
        () => mutationId, () => nowMilliseconds, false,
        successfulWriter,
      );
      const result = await store.recordRoutineEvent({
        id: 'event', routineSessionId: 'routine', sequenceNumber: 1,
        kind: 'started', occurredAtMilliseconds: nowMilliseconds,
      } as never, {
        status: 'inProgress', currentStepIndex: 0, stepElapsedMilliseconds: 0,
        updatedAtMilliseconds: nowMilliseconds,
      });
      expect(result).toEqual({
        ok: false,
        error: { code: errorCode === 'conflict' ? 'conflictingWrite' : 'writeFailed' },
      });
    },
  );

  it('records attention correction without requesting a new plan', async () => {
    const repository = new FakeRepository();
    const store = new AccountAwareKineoStore(
      {
        async completeCheckIn() {
          return { ok: true as const, value: undefined };
        },
      } as unknown as KineoPersistence,
      accountId,
      installationId,
      new FakeSync(),
      repository,
      () => mutationId,
      () => nowMilliseconds,
      false,
      successfulWriter,
    );

    await store.completeCheckIn({ kind: 'attentionCorrection' } as never, []);

    expect(repository.pending[0]?.command).toMatchObject({
      kind: 'submitCheckIn',
      suppressPlan: true,
      attentionTransitions: [],
    });
  });

  it('does not create a local routine when account ownership conflicts', async () => {
    let localCreateCount = 0;
    const base = {
      async loadLatestSelectionDecision() {
        return {
          ok: true as const,
          value: { id: 'decision' },
        };
      },
      async createRoutine() {
        localCreateCount += 1;
        return { ok: true as const, value: undefined };
      },
    } as unknown as KineoPersistence;
    const sync = new FakeSync();
    sync.result = 'conflict';
    const store = new AccountAwareKineoStore(
      base,
      accountId,
      installationId,
      sync,
      new FakeRepository(),
      () => mutationId,
      () => nowMilliseconds,
      false,
      successfulWriter,
    );

    await expect(store.createRoutine({
      id: 'routine',
      decisionId: 'decision',
    } as never)).resolves.toEqual({
      ok: false,
      error: { code: 'conflictingWrite' },
    });
    expect(localCreateCount).toBe(0);
  });

  it('keeps active playback events local and queued while offline', async () => {
    let localEventCount = 0;
    const base = {
      async recordRoutineEvent() {
        localEventCount += 1;
        return { ok: true as const, value: undefined };
      },
    } as unknown as KineoPersistence;
    const sync = new FakeSync();
    sync.result = 'offline';
    const repository = new FakeRepository();
    const store = new AccountAwareKineoStore(
      base,
      accountId,
      installationId,
      sync,
      repository,
      () => mutationId,
      () => nowMilliseconds,
      false,
      {
        async commit(mutation, write) {
          const written = await write(base);
          if (!written.ok) return written;
          const queued = await repository.enqueue(mutation);
          return queued.ok ? { ok: true, value: undefined }
            : { ok: false, error: { code: 'writeFailed' } };
        },
      },
    );

    await expect(store.recordRoutineEvent({
      id: 'event',
      routineSessionId: 'routine',
      sequenceNumber: 1,
      kind: 'started',
      occurredAtMilliseconds: nowMilliseconds,
    } as never, {
      status: 'inProgress',
      currentStepIndex: 0,
      stepElapsedMilliseconds: 0,
      updatedAtMilliseconds: nowMilliseconds,
    })).resolves.toEqual({ ok: true, value: undefined });
    expect(localEventCount).toBe(1);
    expect(repository.pending).toHaveLength(1);
  });
});
