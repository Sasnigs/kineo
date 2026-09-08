import type {
  AccountPrivacyTransport,
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
  SyncCommand,
  SyncChange,
  SyncRequest,
  SyncResponse,
} from '../../core/account/sync-contract';
import type { CheckIn } from '../../core/persistence/persistence-domain';
import {
  createRoutineSession,
  type RoutineSession,
} from '../../core/persistence/routine-persistence-domain';
import {
  buildAuthoritativePlan,
  type ApprovedAuthoritativePlan,
} from '../../core/account/authoritative-plan';
import type {
  BootstrapPage,
  SyncResult,
  SyncTransport,
} from '../../core/account/sync-module';
import type { RefreshTokenVault } from './secure-refresh-token-vault';
import type { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';
import { randomUUID } from 'expo-crypto';

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
type DevelopmentSubmitCheckInCommand = Omit<
  Extract<SyncCommand, { kind: 'submitCheckIn' }>,
  'checkIn'
> & Readonly<{ checkIn: CheckIn }>;

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
    const rejectedMutationIds = new Set<string>();
    let historyEpoch = account.value.historyEpoch;
    for (const mutation of request.mutations) {
      this.cursor += 1;
      if (mutation.command.kind === 'saveProfile') {
        changes.push({
          cursor: String(this.cursor),
          entityKind: 'profile',
          entityId: this.accountId,
          operation: 'upsert',
          payload: mutation.command.profile,
        });
        if (mutation.command.reminderSettings !== undefined) {
          this.cursor += 1;
          changes.push({
            cursor: String(this.cursor),
            entityKind: 'reminderSettings',
            entityId: this.accountId,
            operation: 'upsert',
            payload: mutation.command.reminderSettings,
          });
        }
      } else if (mutation.command.kind === 'acceptLegal') {
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
        const command = mutation.command as DevelopmentSubmitCheckInCommand;
        const hasAttention = command.checkIn.entries.some((entry) =>
          isRecord(entry) &&
          (entry.conditionalSafetyAnswer === 'yes' ||
            entry.conditionalSafetyAnswer === 'notSure')
        );
        if (!hasAttention) {
          const authoritative = buildAuthoritativePlan({
            checkIn: command.checkIn,
            decisionId: command.decisionId as Parameters<typeof buildAuthoritativePlan>[0]['decisionId'],
            revision: command.decisionRevision,
            duration: command.durationVariant,
            requestedOverride: command.requestedOverride,
            secondaryArea: command.checkIn.secondaryArea,
            attentionRequiredAreas: [],
            orderedOutcomes: [],
            createdAtMilliseconds: command.checkIn.completedAtMilliseconds ?? command.checkIn.startedAtMilliseconds,
          });
          if (!authoritative.ok || authoritative.value.kind !== 'approved') {
            rejectedMutationIds.add(mutation.mutationId);
            continue;
          }
          changes.push({
            cursor: String(this.cursor),
            entityKind: 'checkIn',
            entityId: command.checkIn.id,
            operation: 'upsert',
            payload: command.checkIn,
          });
          this.cursor += 1;
          changes.push({
            cursor: String(this.cursor),
            entityKind: 'selectionDecision',
            entityId: command.decisionId,
            operation: 'upsert',
            payload: developmentSelectionEnvelope(
              command,
              authoritative.value,
            ),
          });
        }
      } else if (mutation.command.kind === 'startRoutine') {
        if (!isRoutineSessionCandidate(mutation.command.routine)) {
          rejectedMutationIds.add(mutation.mutationId);
          continue;
        }
        const routine = createRoutineSession(
          mutation.command.routine,
        );
        if (
          !routine.ok ||
          routine.value.status !== 'prepared' ||
          routine.value.decisionId !== mutation.command.decisionId
        ) {
          rejectedMutationIds.add(mutation.mutationId);
          continue;
        }
        changes.push({
          cursor: String(this.cursor),
          entityKind: 'routineSession',
          entityId: routine.value.id,
          operation: 'upsert',
          payload: {
            ownerInstallationId: request.installationId,
            routine: routine.value,
          },
        });
      }
    }
    return {
      ok: true,
      value: {
        accountStatus: 'active',
        historyEpoch,
        dispositions: request.mutations.map(({ mutationId }) =>
          rejectedMutationIds.has(mutationId)
            ? {
                mutationId,
                kind: 'rejected' as const,
                code: 'invalidCommand' as const,
              }
            : { mutationId, kind: 'applied' as const },
        ),
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

  async prepareDeletion(): Promise<PrivacyResult<DeletionResumeCredential>> {
    return {
      ok: true,
      value: {
        jobId: randomUUID(),
        resumeToken: 'development-resume-token',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRoutineSessionCandidate(value: unknown): value is RoutineSession {
  if (!isRecord(value) || !isRecord(value.snapshot) || !isRecord(value.dayContext)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.decisionId === 'string' &&
    typeof value.checkInId === 'string' &&
    typeof value.status === 'string' &&
    typeof value.snapshot.json === 'string' &&
    typeof value.snapshot.checksum === 'string' &&
    Array.isArray(value.snapshot.includedAreas) &&
    typeof value.currentStepIndex === 'number' &&
    typeof value.stepElapsedMilliseconds === 'number' &&
    typeof value.updatedAtMilliseconds === 'number' &&
    (value.startedAtMilliseconds === undefined ||
      typeof value.startedAtMilliseconds === 'number') &&
    (value.endedAtMilliseconds === undefined ||
      typeof value.endedAtMilliseconds === 'number') &&
    typeof value.dayContext.localDay === 'string' &&
    typeof value.dayContext.timeZoneId === 'string' &&
    typeof value.dayContext.calendarId === 'string'
  );
}

function developmentSelectionEnvelope(
  command: DevelopmentSubmitCheckInCommand,
  authoritative: ApprovedAuthoritativePlan,
): Readonly<Record<string, unknown>> {
  const decision = authoritative.decision;
  return {
    decisionId: authoritative.decisionId,
    checkInId: command.checkIn.id,
    revision: authoritative.decisionRevision,
    rulesVersion: authoritative.rulesVersion,
    catalogVersion: authoritative.catalogVersion,
    recommendedLevel: authoritative.recommendedLevel,
    selectedLevel: authoritative.selectedLevel,
    deliveredLevel: authoritative.deliveredLevel,
    durationVariant: authoritative.duration,
    canonicalDecision: decision,
  };
}
