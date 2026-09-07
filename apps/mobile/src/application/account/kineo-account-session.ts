import { validateLegalAcceptance } from '../../core/account/account-domain';
import type {
  LegalAcceptance,
  LegalDocumentKind,
} from '../../core/account/account-domain';
import type { AccountPrivacyModule } from '../../core/account/account-privacy-module';
import type { AuthProvider } from '../../core/account/auth-module';
import {
  createPendingMutation,
  type PendingMutation,
} from '../../core/account/sync-contract';
import type {
  BootstrapState,
  SyncLocalRepository,
  SyncModule,
  SyncOutbox,
  SyncResult,
} from '../../core/account/sync-module';

export const currentLegalDocumentVersion = 'internal-prototype-2026-09-02';
const currentLegalDocumentKinds: readonly LegalDocumentKind[] = [
  'termsOfService',
  'privacyPolicy',
];
const timestampIncrementMilliseconds = 1;

export class KineoAccountSession {
  constructor(
    readonly accountId: string,
    readonly installationId: string,
    readonly provider: AuthProvider,
    readonly sync: SyncModule,
    readonly outbox: SyncOutbox & SyncLocalRepository,
    readonly privacy: AccountPrivacyModule,
    private readonly nextIdentifier: () => string,
    private readonly nowMilliseconds: () => number,
  ) {}

  bootstrap(): Promise<SyncResult<BootstrapState>> {
    return this.sync.bootstrap();
  }

  async synchronizePending(): Promise<SyncResult<BootstrapState>> {
    const pending = await this.outbox.pendingMutations();
    if (!pending.ok) return pending;
    const synchronized = await this.sync.synchronize(pending.value);
    if (!synchronized.ok) return synchronized;
    return {
      ok: true,
      value: {
        account: synchronized.value.account,
        ...(synchronized.value.cursor === undefined
          ? {}
          : { cursor: synchronized.value.cursor }),
      },
    };
  }

  async cachedState(): Promise<SyncResult<BootstrapState | undefined>> {
    const [account, cursor] = await Promise.all([
      this.outbox.loadAccount(),
      this.outbox.loadCursor(),
    ]);
    if (!account.ok) return account;
    if (!cursor.ok) return cursor;
    return account.value === undefined
      ? { ok: true, value: undefined }
      : {
          ok: true,
          value: {
            account: account.value,
            ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
          },
        };
  }

  hasCurrentLegalAcceptances(state: BootstrapState): boolean {
    return currentLegalDocumentKinds.every((documentKind) =>
      state.account.legalAcceptances.some(
        (acceptance) =>
          acceptance.documentKind === documentKind &&
          acceptance.documentVersion === currentLegalDocumentVersion,
      ),
    );
  }

  async acceptCurrentLegalDocuments(
    locale: string,
    state: BootstrapState,
  ): Promise<SyncResult<BootstrapState>> {
    const startTimestamp = this.nowMilliseconds();
    const mutations: PendingMutation[] = [];
    for (const [index, documentKind] of currentLegalDocumentKinds.entries()) {
      const acceptance: LegalAcceptance = {
        documentKind,
        documentVersion: currentLegalDocumentVersion,
        locale,
        acceptedAtMilliseconds:
          startTimestamp + index * timestampIncrementMilliseconds,
      };
      if (!validateLegalAcceptance(acceptance).ok) {
        return { ok: false, error: { code: 'invalidResponse' } };
      }
      const mutation = createPendingMutation({
        mutationId: this.nextIdentifier(),
        accountId: this.accountId,
        installationId: this.installationId,
        historyEpoch: state.account.historyEpoch,
        createdAtMilliseconds: acceptance.acceptedAtMilliseconds,
        command: { kind: 'acceptLegal', acceptance },
      });
      if (!mutation.ok) {
        return { ok: false, error: { code: 'invalidResponse' } };
      }
      const enqueued = await this.outbox.enqueue(mutation.value);
      if (!enqueued.ok) return enqueued;
      mutations.push(mutation.value);
    }
    const synchronized = await this.sync.synchronize(mutations, state.cursor);
    if (!synchronized.ok) return synchronized;
    return {
      ok: true,
      value: {
        account: synchronized.value.account,
        ...(synchronized.value.cursor === undefined
          ? {}
          : { cursor: synchronized.value.cursor }),
      },
    };
  }
}
