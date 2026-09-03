import type { Result } from '../shared/result';
import type { AccountState } from './account-domain';
import type {
  PendingMutation,
  SyncRequest,
  SyncResponse,
} from './sync-contract';

export type BootstrapPage = Readonly<{
  account: AccountState;
  changes: SyncResponse['changes'];
  nextCursor?: string;
  hasMore: boolean;
}>;

export type BootstrapState = Readonly<{
  account: AccountState;
  cursor?: string;
}>;

export type SyncState = BootstrapState & Readonly<{
  pendingMutationCount: number;
}>;

export type SyncError =
  | Readonly<{ code: 'offline' }>
  | Readonly<{ code: 'authenticationRequired' }>
  | Readonly<{ code: 'installationRevoked' }>
  | Readonly<{ code: 'accountDeleting' }>
  | Readonly<{ code: 'conflict' }>
  | Readonly<{ code: 'updateRequired' }>
  | Readonly<{ code: 'invalidResponse' }>
  | Readonly<{ code: 'localPersistence' }>
  | Readonly<{ code: 'unexpected' }>;

export type SyncResult<Value> = Result<Value, SyncError>;

export interface SyncModule {
  bootstrap(): Promise<SyncResult<BootstrapState>>;
  synchronize(
    mutations: readonly PendingMutation[],
    cursor?: string,
  ): Promise<SyncResult<SyncState>>;
}

export interface SyncTransport {
  bootstrap(cursor?: string): Promise<SyncResult<BootstrapPage>>;
  synchronize(request: SyncRequest): Promise<SyncResult<SyncResponse>>;
}

export interface SyncLocalRepository {
  loadAccount(): Promise<SyncResult<AccountState | undefined>>;
  loadCursor(): Promise<SyncResult<string | undefined>>;
  applyBootstrapPage(page: BootstrapPage): Promise<SyncResult<void>>;
  applySyncPage(
    response: SyncResponse,
    sentMutations: readonly PendingMutation[],
  ): Promise<SyncResult<void>>;
  pendingMutationCount(): Promise<SyncResult<number>>;
  loadSynchronizedEntity(
    entityKind: string,
    entityId: string,
  ): Promise<SyncResult<unknown | undefined>>;
}

export interface SyncOutbox {
  enqueue(mutation: PendingMutation): Promise<SyncResult<void>>;
  pendingMutations(): Promise<SyncResult<readonly PendingMutation[]>>;
  discardPendingMutations(): Promise<SyncResult<void>>;
}
