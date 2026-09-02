import type { Result } from '../shared/result';
import type {
  PendingMutation,
  SyncRequest,
  SyncResponse,
} from './sync-contract';

export type BootstrapPage = Readonly<{
  accountStatus: 'active' | 'deleting';
  historyEpoch: number;
  changes: SyncResponse['changes'];
  nextCursor?: string;
  hasMore: boolean;
}>;

export type BootstrapState = Readonly<{
  accountStatus: 'active' | 'deleting';
  historyEpoch: number;
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
