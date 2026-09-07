import type {
  AccountPrivacyModule,
  DeletionStatus,
  ExportStatus,
  PersonalDataExport,
  PrivacyResult,
} from '../../core/account/account-privacy-module';
import type { ReauthenticationGrant } from '../../core/account/auth-module';

export type DeletionResumeCredential = Readonly<{
  jobId: string;
  resumeToken: string;
}>;

export interface AccountPrivacyTransport {
  resetHistory(): Promise<PrivacyResult<Readonly<{ historyEpoch: number }>>>;
  requestExport(): Promise<PrivacyResult<ExportStatus>>;
  downloadExport(
    status: Extract<ExportStatus, { kind: 'ready' }>,
  ): Promise<PrivacyResult<PersonalDataExport>>;
  /** Creates a recovery job without revoking access or removing any data. */
  prepareDeletion(): Promise<PrivacyResult<DeletionResumeCredential>>;
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

  downloadExport(
    status: Extract<ExportStatus, { kind: 'ready' }>,
  ): Promise<PrivacyResult<PersonalDataExport>> {
    return this.transport.downloadExport(status);
  }

  async deleteAccount(
    grant: ReauthenticationGrant,
  ): Promise<PrivacyResult<DeletionStatus>> {
    if (!this.grantIsCurrent(grant)) return reauthenticationRequired();
    const existing = await this.resumeStore.load();
    if (!existing.ok) return existing;
    if (existing.value !== undefined) return this.resumeDeletion();
    const begun = await this.transport.prepareDeletion();
    if (!begun.ok) return begun;
    const saved = await this.resumeStore.save(begun.value);
    if (!saved.ok) return saved;
    return this.resumeDeletion();
  }

  async resumeDeletion(): Promise<PrivacyResult<DeletionStatus>> {
    const resumed = await resumeStoredDeletion(this.transport, this.resumeStore, () => this.localStore.wipeAccount());
    if (!resumed.ok) return resumed;
    if (resumed.value === undefined) {
      // Missing local evidence cannot prove the server deleted this account.
      return { ok: false, error: { code: 'workflowFailed' } };
    }
    return { ok: true, value: resumed.value };
  }

  private grantIsCurrent(grant: ReauthenticationGrant): boolean {
    const now = this.nowMilliseconds();
    return Number.isSafeInteger(now) &&
      now > 0 &&
      grant.value.length > 0 &&
      grant.expiresAtMilliseconds > now;
  }
}

/** Runs before session restoration; deletion recovery does not need an Auth user. */
export async function resumeStoredDeletion(
  transport: Pick<AccountPrivacyTransport, 'deletionStatus'>,
  resumeStore: DeletionResumeStore,
  wipeAccount: () => Promise<PrivacyResult<void>>,
): Promise<PrivacyResult<DeletionStatus | undefined>> {
  const credential = await resumeStore.load();
  if (!credential.ok) return credential;
  if (credential.value === undefined) return { ok: true, value: undefined };
  const status = await transport.deletionStatus(credential.value);
  if (!status.ok || status.value.kind !== 'complete') return status;
  const wiped = await wipeAccount();
  if (!wiped.ok) return wiped;
  const cleared = await resumeStore.clear();
  return cleared.ok ? { ok: true, value: { kind: 'complete' } } : cleared;
}

function reauthenticationRequired<Value>(): PrivacyResult<Value> {
  return { ok: false, error: { code: 'reauthenticationRequired' } };
}
