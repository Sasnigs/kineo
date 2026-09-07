import {
  type BootstrapPage,
  type BootstrapState,
  type SyncLocalRepository,
  type SyncModule,
  type SyncResult,
  type SyncState,
  type SyncTransport,
} from '../../core/account/sync-module';
import {
  createSyncRequest,
  type PendingMutation,
  type SyncResponse,
} from '../../core/account/sync-contract';

export const maximumSyncPageCount = 1_000;
export const maximumSyncMutationCount = 100;

export class KineoSyncModule implements SyncModule {
  private operationInFlight?: Promise<SyncResult<BootstrapState | SyncState>>;

  constructor(
    private readonly accountId: string,
    private readonly installationId: string,
    private readonly transport: SyncTransport,
    private readonly repository: SyncLocalRepository,
  ) {}

  bootstrap(): Promise<SyncResult<BootstrapState>> {
    return this.serialize(() => this.performBootstrap()) as Promise<
      SyncResult<BootstrapState>
    >;
  }

  synchronize(
    mutations: readonly PendingMutation[],
    cursor?: string,
  ): Promise<SyncResult<SyncState>> {
    return this.serialize(() => this.performSynchronize(mutations, cursor)) as Promise<
      SyncResult<SyncState>
    >;
  }

  private serialize<Value extends BootstrapState | SyncState>(
    operation: () => Promise<SyncResult<Value>>,
  ): Promise<SyncResult<Value>> {
    const current = this.operationInFlight;
    if (current !== undefined) {
      return current.then(() => this.serialize(operation));
    }
    const started = operation();
    this.operationInFlight = started.finally(() => {
      this.operationInFlight = undefined;
    });
    return started;
  }

  private async performBootstrap(): Promise<SyncResult<BootstrapState>> {
    const storedCursor = await this.repository.loadCursor();
    if (!storedCursor.ok) return storedCursor;
    let cursor = storedCursor.value;
    let finalPage: BootstrapPage | undefined;

    for (let pageIndex = 0; pageIndex < maximumSyncPageCount; pageIndex += 1) {
      const page = await this.transport.bootstrap(cursor);
      if (!page.ok) return page;
      if (page.value.account.accountId !== this.accountId) {
        return invalidResponse();
      }
      const nextCursor = validatedNextCursor(cursor, page.value);
      if (!nextCursor.ok) return nextCursor;
      const applied = await this.repository.applyBootstrapPage(page.value);
      if (!applied.ok) return applied;
      finalPage = page.value;
      cursor = nextCursor.value;
      if (!page.value.hasMore) {
        return {
          ok: true,
          value: {
            account: page.value.account,
            ...(cursor === undefined ? {} : { cursor }),
          },
        };
      }
    }
    return finalPage === undefined
      ? invalidResponse()
      : { ok: false, error: { code: 'invalidResponse' } };
  }

  private async performSynchronize(
    mutations: readonly PendingMutation[],
    requestedCursor?: string,
  ): Promise<SyncResult<SyncState>> {
    const storedCursor = requestedCursor === undefined
      ? await this.repository.loadCursor()
      : { ok: true as const, value: requestedCursor };
    if (!storedCursor.ok) return storedCursor;
    let cursor = storedCursor.value;
    let remainingMutations = mutations;
    let finalResponse: SyncResponse | undefined;

    // Validate the complete outbox before partitioning so duplicates and ordering
    // violations across batch boundaries cannot be hidden by pagination.
    const validated = createSyncRequest({
      expectedAccountId: this.accountId,
      installationId: this.installationId,
      mutations,
    });
    if (!validated.ok) return invalidResponse();

    for (let pageIndex = 0; pageIndex < maximumSyncPageCount; pageIndex += 1) {
      const batch = remainingMutations.slice(0, maximumSyncMutationCount);
      const request = createSyncRequest({
        expectedAccountId: this.accountId,
        installationId: this.installationId,
        ...(cursor === undefined ? {} : { cursor }),
        mutations: batch,
      });
      if (!request.ok) return invalidResponse();
      const response = await this.transport.synchronize(request.value);
      if (!response.ok) return response;
      if (!validDispositions(response.value, batch)) {
        return invalidResponse();
      }
      const nextCursor = validatedNextCursor(cursor, response.value);
      if (!nextCursor.ok) return nextCursor;
      const applied = await this.repository.applySyncPage(
        response.value,
        batch,
      );
      if (!applied.ok) return applied;
      finalResponse = response.value;
      cursor = nextCursor.value;

      const rejected = response.value.dispositions.find(
        ({ kind }) => kind === 'rejected',
      );
      if (rejected?.kind === 'rejected') {
        return { ok: false, error: rejectedError(rejected.code) };
      }
      if (response.value.dispositions.some(({ kind }) => kind === 'conflict')) {
        return { ok: false, error: { code: 'conflict' } };
      }
      remainingMutations = remainingMutations.slice(batch.length);
      if (!response.value.hasMore && remainingMutations.length === 0) break;
    }

    if (finalResponse === undefined || finalResponse.hasMore || remainingMutations.length > 0) {
      return invalidResponse();
    }
    const pending = await this.repository.pendingMutationCount();
    if (!pending.ok) return pending;
    const account = await this.repository.loadAccount();
    if (!account.ok || account.value === undefined) {
      return account.ok ? invalidResponse() : account;
    }
    return {
      ok: true,
      value: {
        account: account.value,
        ...(cursor === undefined ? {} : { cursor }),
        pendingMutationCount: pending.value,
      },
    };
  }
}

type CursorPage = Readonly<{
  changes: readonly Readonly<{ cursor: string }>[];
  nextCursor?: string;
  hasMore: boolean;
}>;

function validatedNextCursor(
  current: string | undefined,
  page: CursorPage,
): SyncResult<string | undefined> {
  const lastChangeCursor = page.changes.at(-1)?.cursor;
  if (
    page.hasMore &&
    (page.nextCursor === undefined || page.nextCursor === current)
  ) {
    return invalidResponse();
  }
  if (
    lastChangeCursor !== undefined &&
    page.nextCursor !== lastChangeCursor
  ) {
    return invalidResponse();
  }
  return {
    ok: true,
    value: page.nextCursor ?? current,
  };
}

function validDispositions(
  response: SyncResponse,
  mutations: readonly PendingMutation[],
): boolean {
  const expected = new Set(mutations.map(({ mutationId }) => mutationId));
  const actual = response.dispositions.map(({ mutationId }) => mutationId);
  return actual.length === expected.size &&
    actual.every((mutationId) => expected.delete(mutationId)) &&
    expected.size === 0;
}

function rejectedError(
  code: Extract<SyncResponse['dispositions'][number], { kind: 'rejected' }>['code'],
): Extract<SyncResult<never>, { ok: false }>['error'] {
  switch (code) {
    case 'installationRevoked':
      return { code: 'installationRevoked' };
    case 'accountDeleting':
      return { code: 'accountDeleting' };
    case 'routineOwnedByAnotherInstallation':
      return { code: 'conflict' };
    case 'staleHistoryEpoch':
    case 'invalidCommand':
      return { code: 'invalidResponse' };
  }
}

function invalidResponse<Value>(): SyncResult<Value> {
  return { ok: false, error: { code: 'invalidResponse' } };
}
