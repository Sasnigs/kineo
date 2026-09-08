import { describe, expect, it } from '@jest/globals';

import type {
  BootstrapPage,
  SyncLocalRepository,
  SyncResult,
  SyncTransport,
} from '../../core/account/sync-module';
import type {
  PendingMutation,
  SyncRequest,
  SyncResponse,
} from '../../core/account/sync-contract';
import { KineoSyncModule, maximumSyncMutationCount } from './kineo-sync-module';

const accountId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000002';

function account(historyEpoch = 1) {
  return {
    accountId,
    status: 'active' as const,
    historyEpoch,
    legalAcceptances: [],
  };
}

class FakeRepository implements SyncLocalRepository {
  async isHydrated() { return { ok: true as const, value: true }; }
  cursor?: string;
  pages: (BootstrapPage | SyncResponse)[] = [];
  pendingCount = 0;

  async loadAccount() {
    return { ok: true as const, value: account() };
  }

  async loadCursor(): Promise<SyncResult<string | undefined>> {
    return { ok: true, value: this.cursor };
  }

  async applyBootstrapPage(page: BootstrapPage): Promise<SyncResult<void>> {
    this.pages.push(page);
    this.cursor = page.nextCursor ?? this.cursor;
    return { ok: true, value: undefined };
  }

  async applySyncPage(response: SyncResponse): Promise<SyncResult<void>> {
    this.pages.push(response);
    this.cursor = response.nextCursor ?? this.cursor;
    return { ok: true, value: undefined };
  }

  async pendingMutationCount(): Promise<SyncResult<number>> {
    return { ok: true, value: this.pendingCount };
  }

  async loadSynchronizedEntity() {
    return { ok: true as const, value: undefined };
  }
}

class FakeTransport implements SyncTransport {
  bootstrapPages: BootstrapPage[] = [];
  syncPages: SyncResponse[] = [];
  requests: SyncRequest[] = [];

  async bootstrap(): Promise<SyncResult<BootstrapPage>> {
    const page = this.bootstrapPages.shift();
    return page === undefined
      ? { ok: false, error: { code: 'invalidResponse' } }
      : { ok: true, value: page };
  }

  async synchronize(request: SyncRequest): Promise<SyncResult<SyncResponse>> {
    this.requests.push(request);
    const page = this.syncPages.shift();
    return page === undefined
      ? { ok: false, error: { code: 'invalidResponse' } }
      : { ok: true, value: page };
  }
}

const mutation: PendingMutation = {
  mutationId: '30000000-0000-4000-8000-000000000003',
  accountId,
  installationId,
  historyEpoch: 1,
  createdAtMilliseconds: 1_788_300_000_000,
  command: { kind: 'resetHistory' },
};

describe('KineoSyncModule', () => {
  it('batches a large offline outbox without losing or resending mutations', async () => {
    const mutations = Array.from({ length: maximumSyncMutationCount + 1 }, (_, index) => ({
      ...mutation,
      mutationId: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    const transport = new FakeTransport();
    transport.syncPages = [
      mutations.slice(0, maximumSyncMutationCount),
      mutations.slice(maximumSyncMutationCount),
    ].map((batch) => ({
      accountStatus: 'active', historyEpoch: 1,
      dispositions: batch.map(({ mutationId }) => ({ mutationId, kind: 'applied' })),
      changes: [], hasMore: false,
    }));
    const module = new KineoSyncModule(accountId, installationId, transport, new FakeRepository());

    expect((await module.synchronize(mutations)).ok).toBe(true);
    expect(transport.requests.map(({ mutations }) => mutations.length))
      .toEqual([maximumSyncMutationCount, 1]);
    expect(transport.requests.flatMap(({ mutations }) => mutations.map(({ mutationId }) => mutationId)))
      .toEqual(mutations.map(({ mutationId }) => mutationId));
  });

  it('hydrates every bootstrap page in cursor order', async () => {
    const transport = new FakeTransport();
    transport.bootstrapPages = [
      {
        account: account(),
        changes: [{ cursor: '10', entityKind: 'profile', entityId: accountId, operation: 'upsert' }],
        nextCursor: '10',
        hasMore: true,
      },
      {
        account: account(),
        changes: [{ cursor: '11', entityKind: 'checkIn', entityId: 'item', operation: 'upsert' }],
        nextCursor: '11',
        hasMore: false,
      },
    ];
    const repository = new FakeRepository();
    const module = new KineoSyncModule(accountId, installationId, transport, repository);

    await expect(module.bootstrap()).resolves.toEqual({
      ok: true,
      value: { account: account(), cursor: '11' },
    });
    expect(repository.pages).toHaveLength(2);
  });

  it('pushes mutations once and uses empty pushes for later pull pages', async () => {
    const transport = new FakeTransport();
    transport.syncPages = [
      {
        accountStatus: 'active', historyEpoch: 1,
        dispositions: [{ mutationId: mutation.mutationId, kind: 'applied' }],
        changes: [{ cursor: '20', entityKind: 'history', entityId: accountId, operation: 'reset' }],
        nextCursor: '20', hasMore: true,
      },
      {
        accountStatus: 'active', historyEpoch: 2,
        dispositions: [], changes: [], nextCursor: '20', hasMore: false,
      },
    ];
    const repository = new FakeRepository();
    const module = new KineoSyncModule(accountId, installationId, transport, repository);

    const result = await module.synchronize([mutation]);
    expect(result.ok).toBe(true);
    expect(transport.requests.map(({ mutations }) => mutations.length)).toEqual([1, 0]);
  });

  it('rejects a stalled paginated cursor instead of looping forever', async () => {
    const transport = new FakeTransport();
    transport.bootstrapPages = [{
      account: account(), changes: [], hasMore: true,
    }];
    const module = new KineoSyncModule(
      accountId,
      installationId,
      transport,
      new FakeRepository(),
    );

    await expect(module.bootstrap()).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' },
    });
  });

  it('persists conflict state before surfacing the conflict', async () => {
    const transport = new FakeTransport();
    transport.syncPages = [{
      accountStatus: 'active', historyEpoch: 1,
      dispositions: [{ mutationId: mutation.mutationId, kind: 'conflict', authoritativeVersion: 2 }],
      changes: [], hasMore: false,
    }];
    const repository = new FakeRepository();
    const module = new KineoSyncModule(accountId, installationId, transport, repository);

    await expect(module.synchronize([mutation])).resolves.toEqual({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(repository.pages).toHaveLength(1);
  });

  it('rejects malformed sync pagination before writing any local state', async () => {
    const transport = new FakeTransport();
    transport.syncPages = [{
      accountStatus: 'active', historyEpoch: 1,
      dispositions: [{ mutationId: mutation.mutationId, kind: 'applied' }],
      changes: [{ cursor: '20', entityKind: 'history', entityId: accountId, operation: 'reset' }],
      nextCursor: '19', hasMore: false,
    }];
    const repository = new FakeRepository();
    const module = new KineoSyncModule(accountId, installationId, transport, repository);

    await expect(module.synchronize([mutation])).resolves.toEqual({
      ok: false, error: { code: 'invalidResponse' },
    });
    expect(repository.pages).toHaveLength(0);
  });
});
