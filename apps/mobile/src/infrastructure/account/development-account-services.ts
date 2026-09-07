import type {
  AccountPrivacyTransport,
  DeleteAccountResponse,
  DeletionResumeCredential,
} from '../../application/account/kineo-account-privacy-module';
import type { AuthGateway, IdentityTokenProvider } from '../../application/account/kineo-auth-module';
import type { EmailCredentials } from '../../core/account/account-domain';
import type {
  AuthProvider,
  AuthResult,
  AuthState,
  ReauthenticationGrant,
  ReauthenticationMethod,
} from '../../core/account/auth-module';
import type {
  DeletionStatus,
  ExportStatus,
  PrivacyResult,
} from '../../core/account/account-privacy-module';
import type {
  SyncChange,
  SyncRequest,
  SyncResponse,
} from '../../core/account/sync-contract';
import type {
  BootstrapPage,
  SyncResult,
  SyncTransport,
} from '../../core/account/sync-module';
import type { RefreshTokenVault } from './secure-refresh-token-vault';
import type { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';
import { randomUUID } from 'expo-crypto';
import { selectAreaLevel } from '../../core/selection/area-level-rule';
import type { RoutineLevel } from '../../core/domain/selection-domain';

export const developmentAccountId =
  '10000000-0000-4000-8000-000000000001';
const developmentRefreshToken = 'kineo-development-session';
const developmentIdentityToken = 'kineo-development-identity';
const developmentProvider: AuthProvider = 'email';
const firstCursor = 1;
const millisecondsPerSecond = 1_000;
const secondsPerMinute = 60;
const reauthenticationLifetimeMinutes = 5;
const reauthenticationLifetimeMilliseconds =
  reauthenticationLifetimeMinutes * secondsPerMinute * millisecondsPerSecond;

export class DevelopmentIdentityProvider implements IdentityTokenProvider {
  async acquireIdentityToken() {
    return {
      ok: true as const,
      value: { token: developmentIdentityToken },
    };
  }
}

export class DevelopmentAuthGateway implements AuthGateway {
  constructor(
    private readonly vault: RefreshTokenVault,
    private readonly nowMilliseconds: () => number,
  ) {}

  async restoreSession(): Promise<AuthResult<AuthState>> {
    const loaded = await this.vault.load();
    if (!loaded.ok) return loaded;
    return {
      ok: true,
      value: loaded.value?.refreshToken === developmentRefreshToken
        ? authenticated()
        : { kind: 'signedOut' },
    };
  }

  signInWithIdentityToken(
    _provider: Extract<AuthProvider, 'apple' | 'google'>,
  ): Promise<AuthResult<AuthState>> {
    return this.signIn();
  }

  signUpWithEmail(_credentials: EmailCredentials): Promise<AuthResult<AuthState>> {
    return this.signIn();
  }

  signInWithEmail(_credentials: EmailCredentials): Promise<AuthResult<AuthState>> {
    return this.signIn();
  }

  async resendVerification(_email: string): Promise<AuthResult<void>> {
    return { ok: true, value: undefined };
  }

  async requestPasswordReset(_email: string): Promise<AuthResult<void>> {
    return { ok: true, value: undefined };
  }

  completeEmailVerification(
    _callbackUrl: string,
  ): Promise<AuthResult<AuthState>> {
    return this.signIn();
  }

  completePasswordReset(
    _recoveryUrl: string,
    _newPassword: string,
  ): Promise<AuthResult<AuthState>> {
    return this.signIn();
  }

  async updatePassword(
    _newPassword: string,
    _currentPassword: string,
  ): Promise<AuthResult<void>> {
    return { ok: true, value: undefined };
  }

  async reauthenticate(
    _method: ReauthenticationMethod,
  ): Promise<AuthResult<ReauthenticationGrant>> {
    return this.createReauthenticationGrant();
  }

  async createReauthenticationGrant(): Promise<AuthResult<ReauthenticationGrant>> {
    return {
      ok: true,
      value: {
        value: randomUUID(),
        expiresAtMilliseconds:
          this.nowMilliseconds() + reauthenticationLifetimeMilliseconds,
      },
    };
  }

  async logout(): Promise<AuthResult<void>> {
    return this.vault.clear();
  }

  private async signIn(): Promise<AuthResult<AuthState>> {
    const stored = await this.vault.save({
      refreshToken: developmentRefreshToken,
      identity: { accountId: developmentAccountId, provider: developmentProvider },
    });
    return stored.ok ? { ok: true, value: authenticated() } : stored;
  }
}

export class DevelopmentSyncTransport implements SyncTransport {
  private cursor = firstCursor - 1;

  constructor(
    private readonly repository: KineoSqliteSyncRepository,
    private readonly accountId: string,
  ) {}

  async bootstrap(): Promise<SyncResult<BootstrapPage>> {
    const stored = await this.repository.loadAccount();
    if (!stored.ok) return stored;
    return {
      ok: true,
      value: {
        account: stored.value ?? {
          accountId: this.accountId,
          status: 'active',
          historyEpoch: 1,
          legalAcceptances: [],
        },
        changes: [],
        hasMore: false,
      },
    };
  }

  async synchronize(request: SyncRequest): Promise<SyncResult<SyncResponse>> {
    const account = await this.repository.loadAccount();
    if (!account.ok || account.value === undefined) {
      return account.ok
        ? { ok: false, error: { code: 'localPersistence' } }
        : account;
    }
    const changes: SyncChange[] = [];
    let historyEpoch = account.value.historyEpoch;
    for (const mutation of request.mutations) {
      this.cursor += 1;
      if (mutation.command.kind === 'acceptLegal') {
        changes.push({
          cursor: String(this.cursor),
          entityKind: 'legalAcceptance',
          entityId: `${mutation.command.acceptance.documentKind}:${mutation.command.acceptance.documentVersion}`,
          operation: 'upsert',
          payload: mutation.command.acceptance,
        });
      } else if (mutation.command.kind === 'resetHistory') {
        historyEpoch += 1;
        changes.push({
          cursor: String(this.cursor),
          entityKind: 'history',
          entityId: this.accountId,
          operation: 'reset',
          payload: { historyEpoch },
        });
      } else if (
        mutation.command.kind === 'submitCheckIn' &&
        isRecord(mutation.command.checkIn) &&
        Array.isArray(mutation.command.checkIn.entries)
      ) {
        const levels = mutation.command.checkIn.entries.flatMap((entry) =>
          isRecord(entry) &&
          (entry.changeReport === 'better' ||
            entry.changeReport === 'similar' ||
            entry.changeReport === 'worse') &&
          (entry.movementComfort === 'limited' ||
            entry.movementComfort === 'okay' ||
            entry.movementComfort === 'good')
            ? [selectAreaLevel({
                changeReport: entry.changeReport,
                movementComfort: entry.movementComfort,
                activeUnlocked: false,
              })]
            : [],
        );
        const hasAttention = mutation.command.checkIn.entries.some((entry) =>
          isRecord(entry) &&
          (entry.conditionalSafetyAnswer === 'yes' ||
            entry.conditionalSafetyAnswer === 'notSure')
        );
        const recommendedLevel = levels.reduce<RoutineLevel>(
          gentlerLevel,
          'active',
        );
        const selectedLevel = mutation.command.requestedOverride === undefined
          ? recommendedLevel
          : gentlerLevel(
              recommendedLevel,
              mutation.command.requestedOverride,
            );
        if (!hasAttention) {
          changes.push({
            cursor: String(this.cursor),
            entityKind: 'selectionDecision',
            entityId: mutation.command.decisionId,
            operation: 'upsert',
            payload: {
              decisionId: mutation.command.decisionId,
              checkInId: mutation.command.checkIn.id,
              revision: mutation.command.decisionRevision,
              rulesVersion: 'selection-v1.0.0-prototype',
              catalogVersion: '0.1.0',
              recommendedLevel,
              selectedLevel,
              deliveredLevel: selectedLevel,
              durationVariant: mutation.command.durationVariant,
            },
          });
        }
      }
    }
    return {
      ok: true,
      value: {
        accountStatus: 'active',
        historyEpoch,
        dispositions: request.mutations.map(({ mutationId }) => ({
          mutationId,
          kind: 'applied' as const,
        })),
        changes,
        ...(changes.length === 0
          ? {}
          : { nextCursor: changes.at(-1)?.cursor }),
        hasMore: false,
      },
    };
  }
}

export class DevelopmentPrivacyTransport implements AccountPrivacyTransport {
  constructor(
    private readonly repository: KineoSqliteSyncRepository,
  ) {}

  async resetHistory() {
    const account = await this.repository.loadAccount();
    return account.ok && account.value !== undefined
      ? {
          ok: true as const,
          value: { historyEpoch: account.value.historyEpoch + 1 },
        }
      : { ok: false as const, error: { code: 'workflowFailed' as const } };
  }

  async requestExport(): Promise<PrivacyResult<ExportStatus>> {
    return {
      ok: true,
      value: {
        kind: 'ready',
        jobId: randomUUID(),
        expiresAtMilliseconds:
          Date.now() + reauthenticationLifetimeMilliseconds,
        downloadToken: 'development-download-token',
      },
    };
  }

  async downloadExport() {
    const account = await this.repository.loadAccount();
    return account.ok && account.value !== undefined
      ? {
          ok: true as const,
          value: {
            formatVersion: 'kineo-export-v1',
            generatedForInternalTesting: true,
            account: account.value,
          },
        }
      : { ok: false as const, error: { code: 'workflowFailed' as const } };
  }

  async deleteAccount(): Promise<PrivacyResult<DeleteAccountResponse>> {
    return {
      ok: true,
      value: {
        status: { kind: 'complete' },
        resumeCredential: {
          jobId: randomUUID(),
          resumeToken: 'development-resume-token',
        },
      },
    };
  }

  async deletionStatus(
    _credential: DeletionResumeCredential,
  ): Promise<PrivacyResult<DeletionStatus>> {
    return { ok: true, value: { kind: 'complete' } };
  }
}

function authenticated(): Extract<AuthState, { kind: 'authenticated' }> {
  return {
    kind: 'authenticated',
    accountId: developmentAccountId,
    provider: developmentProvider,
  };
}

function gentlerLevel(left: RoutineLevel, right: RoutineLevel): RoutineLevel {
  const rank: Readonly<Record<RoutineLevel, number>> = {
    gentle: 0,
    balanced: 1,
    active: 2,
  };
  return rank[left] <= rank[right] ? left : right;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
