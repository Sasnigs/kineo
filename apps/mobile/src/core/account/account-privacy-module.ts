import type { Result } from '../shared/result';
import type { ReauthenticationGrant } from './auth-module';

export type ExportStatus =
  | Readonly<{ kind: 'pending'; requestedAtMilliseconds: number }>
  | Readonly<{
      kind: 'ready';
      jobId: string;
      expiresAtMilliseconds: number;
      downloadToken: string;
    }>;

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
export type PersonalDataExport = Readonly<Record<string, unknown>>;

export interface PersonalDataExportSharer {
  share(data: PersonalDataExport): Promise<PrivacyResult<void>>;
}

export interface AccountPrivacyModule {
  resetHistory(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<void>>;
  requestExport(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<ExportStatus>>;
  downloadExport(
    status: Extract<ExportStatus, { kind: 'ready' }>,
  ): Promise<PrivacyResult<PersonalDataExport>>;
  deleteAccount(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<DeletionStatus>>;
  resumeDeletion(): Promise<PrivacyResult<DeletionStatus>>;
}
