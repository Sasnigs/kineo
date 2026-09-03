import type {
  AccountPrivacyTransport,
  DeleteAccountResponse,
  DeletionResumeCredential,
} from '../../application/account/kineo-account-privacy-module';
import type {
  DeletionStatus,
  ExportStatus,
  PrivacyResult,
} from '../../core/account/account-privacy-module';
import type { SupabaseFunctionsPort } from './supabase-sync-transport';

const unauthorizedStatus = 401;
const tooManyRequestsStatus = 429;
const conflictStatus = 409;

export class SupabaseAccountPrivacyTransport
implements AccountPrivacyTransport {
  constructor(
    private readonly functions: SupabaseFunctionsPort,
    private readonly installationId: string,
    private readonly currentHistoryEpoch: () => Promise<number | undefined>,
    private readonly nextIdentifier: () => string,
  ) {}

  async resetHistory(): Promise<
    PrivacyResult<Readonly<{ historyEpoch: number }>>
  > {
    const historyEpoch = await this.currentHistoryEpoch();
    if (historyEpoch === undefined) return workflowFailure();
    const response = await this.invoke('reset-history', {
      installationId: this.installationId,
      mutationId: this.nextIdentifier(),
      historyEpoch,
    });
    if (!response.ok) return response;
    return isRecord(response.value) &&
      isPositiveSafeInteger(response.value.historyEpoch)
      ? {
          ok: true,
          value: { historyEpoch: response.value.historyEpoch },
        }
      : workflowFailure();
  }

  async requestExport(): Promise<PrivacyResult<ExportStatus>> {
    const response = await this.invoke('request-export', {});
    if (!response.ok) return response;
    const value = response.value;
    return isRecord(value) &&
      value.kind === 'ready' &&
      typeof value.jobId === 'string' &&
      typeof value.downloadToken === 'string' &&
      isPositiveSafeInteger(value.expiresAtMilliseconds)
      ? {
          ok: true,
          value: {
            kind: 'ready',
            jobId: value.jobId,
            downloadToken: value.downloadToken,
            expiresAtMilliseconds: value.expiresAtMilliseconds,
          },
        }
      : workflowFailure();
  }

  async deleteAccount(): Promise<PrivacyResult<DeleteAccountResponse>> {
    const response = await this.invoke('delete-account', {});
    if (!response.ok) return response;
    const value = response.value;
    if (
      !isRecord(value) ||
      (value.kind !== 'pending' && value.kind !== 'complete') ||
      typeof value.jobId !== 'string' ||
      typeof value.resumeToken !== 'string'
    ) {
      return workflowFailure();
    }
    return {
      ok: true,
      value: {
        status: { kind: value.kind },
        resumeCredential: {
          jobId: value.jobId,
          resumeToken: value.resumeToken,
        },
      },
    };
  }

  async deletionStatus(
    credential: DeletionResumeCredential,
  ): Promise<PrivacyResult<DeletionStatus>> {
    const response = await this.invoke('deletion-status', credential);
    if (!response.ok) return response;
    return isRecord(response.value) &&
      (response.value.kind === 'pending' ||
        response.value.kind === 'revokingAccess' ||
        response.value.kind === 'deletingData' ||
        response.value.kind === 'complete')
      ? { ok: true, value: { kind: response.value.kind } }
      : workflowFailure();
  }

  private async invoke(
    functionName: string,
    body: object,
  ): Promise<PrivacyResult<unknown>> {
    try {
      const response = await this.functions.invoke(functionName, { body });
      if (response.error === null) return { ok: true, value: response.data };
      switch (response.error.context?.status) {
        case unauthorizedStatus:
          return {
            ok: false,
            error: { code: 'reauthenticationRequired' },
          };
        case tooManyRequestsStatus:
          return { ok: false, error: { code: 'rateLimited' } };
        case conflictStatus:
          return { ok: false, error: { code: 'workflowFailed' } };
        default:
          return { ok: false, error: { code: 'workflowFailed' } };
      }
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0;
}

function workflowFailure<Value>(): PrivacyResult<Value> {
  return { ok: false, error: { code: 'workflowFailed' } };
}
