import type { Result } from '../shared/result';
import type { ReauthenticationGrant } from './auth-module';

export type ExportStatus =
  | Readonly<{ kind: 'pending'; requestedAtMilliseconds: number }>
  | Readonly<{ kind: 'ready'; expiresAtMilliseconds: number; downloadToken: string }>;

export type DeletionStatus =
  | Readonly<{ kind: 'pending' }>
  | Readonly<{ kind: 'revokingAccess' }>
  | Readonly<{ kind: 'deletingData' }>
  | Readonly<{ kind: 'complete' }>;

export type PrivacyError =
  | Readonly<{ code: 'offline' }>
  | Readonly<{ code: 'reauthenticationRequired' }>
  | Readonly<{ code: 'notAuthorized' }>
  | Readonly<{ code: 'rateLimited'; retryAfterMilliseconds?: number }>
  | Readonly<{ code: 'workflowFailed' }>
  | Readonly<{ code: 'localWipeFailed' }>
  | Readonly<{ code: 'unexpected' }>;

export type PrivacyResult<Value> = Result<Value, PrivacyError>;

export interface AccountPrivacyModule {
  resetHistory(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<void>>;
  requestExport(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<ExportStatus>>;
  deleteAccount(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<DeletionStatus>>;
  resumeDeletion(): Promise<PrivacyResult<DeletionStatus>>;
}
