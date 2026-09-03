import type {
  AccountPrivacyModule,
  DeletionStatus,
  ExportStatus,
  PrivacyResult,
} from '../../core/account/account-privacy-module';
import type { ReauthenticationGrant } from '../../core/account/auth-module';

export type DeletionResumeCredential = Readonly<{
  jobId: string;
  resumeToken: string;
}>;

export type DeleteAccountResponse = Readonly<{
  status: DeletionStatus;
  resumeCredential: DeletionResumeCredential;
}>;

export interface AccountPrivacyTransport {
  resetHistory(): Promise<PrivacyResult<Readonly<{ historyEpoch: number }>>>;
  requestExport(): Promise<PrivacyResult<ExportStatus>>;
  deleteAccount(): Promise<PrivacyResult<DeleteAccountResponse>>;
  deletionStatus(
    credential: DeletionResumeCredential,
  ): Promise<PrivacyResult<DeletionStatus>>;
}

export interface DeletionResumeStore {
  load(): Promise<PrivacyResult<DeletionResumeCredential | undefined>>;
  save(credential: DeletionResumeCredential): Promise<PrivacyResult<void>>;
  clear(): Promise<PrivacyResult<void>>;
}

export interface LocalPrivacyStore {
  resetHistory(historyEpoch: number): Promise<PrivacyResult<void>>;
  wipeAccount(): Promise<PrivacyResult<void>>;
}

export class KineoAccountPrivacyModule implements AccountPrivacyModule {
  constructor(
    private readonly transport: AccountPrivacyTransport,
    private readonly resumeStore: DeletionResumeStore,
    private readonly localStore: LocalPrivacyStore,
    private readonly nowMilliseconds: () => number,
  ) {}

  async resetHistory(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<void>> {
    if (!this.grantIsCurrent(grant)) return reauthenticationRequired();
    const reset = await this.transport.resetHistory();
    if (!reset.ok) return reset;
    return this.localStore.resetHistory(reset.value.historyEpoch);
  }

  requestExport(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<ExportStatus>> {
    return this.grantIsCurrent(grant)
      ? this.transport.requestExport()
      : Promise.resolve(reauthenticationRequired());
  }

  async deleteAccount(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<DeletionStatus>> {
    if (!this.grantIsCurrent(grant)) return reauthenticationRequired();
    const begun = await this.transport.deleteAccount();
    if (!begun.ok) return begun;
    const saved = await this.resumeStore.save(begun.value.resumeCredential);
    if (!saved.ok) return saved;
    if (begun.value.status.kind !== 'complete') {
      return { ok: true, value: begun.value.status };
    }
    return this.finishLocalDeletion();
  }

  async resumeDeletion(): Promise<PrivacyResult<DeletionStatus>> {
    const credential = await this.resumeStore.load();
    if (!credential.ok) return credential;
    if (credential.value === undefined) {
      return { ok: true, value: { kind: 'complete' } };
    }
    const status = await this.transport.deletionStatus(credential.value);
    if (!status.ok || status.value.kind !== 'complete') return status;
    return this.finishLocalDeletion();
  }

  private async finishLocalDeletion(): Promise<PrivacyResult<DeletionStatus>> {
    const wiped = await this.localStore.wipeAccount();
    if (!wiped.ok) return wiped;
    const cleared = await this.resumeStore.clear();
    return cleared.ok
      ? { ok: true, value: { kind: 'complete' } }
      : cleared;
  }

  private grantIsCurrent(grant: ReauthenticationGrant): boolean {
    const now = this.nowMilliseconds();
    return Number.isSafeInteger(now) &&
      now > 0 &&
      grant.value.length > 0 &&
      grant.expiresAtMilliseconds > now;
  }
}

function reauthenticationRequired<Value>(): PrivacyResult<Value> {
  return { ok: false, error: { code: 'reauthenticationRequired' } };
}
