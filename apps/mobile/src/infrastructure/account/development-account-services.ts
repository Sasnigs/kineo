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
import {
  createCheckIn,
  createSafetyMutation,
  type CheckIn,
  type SafetyEvent,
  type SafetyMutation,
} from '../../core/persistence/persistence-domain';
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
      } else if (mutation.command.kind === 'submitCheckIn') {
        const checkIn = parseDevelopmentCheckIn(mutation.command.checkIn);
        if (checkIn === undefined) {
          rejectedMutationIds.add(mutation.mutationId);
          continue;
        }
        const command: DevelopmentSubmitCheckInCommand = {
          ...mutation.command,
          checkIn,
        };
        const transitions = parseDevelopmentSafetyTransitions(
          checkIn,
          command.attentionTransitions,
        );
        if (transitions === undefined) {
          rejectedMutationIds.add(mutation.mutationId);
          continue;
        }
        const mutationChanges: SyncChange[] = [{
          cursor: String(this.cursor),
          entityKind: 'checkIn',
          entityId: checkIn.id,
          operation: 'upsert',
          payload: checkIn,
        }];
        for (const transition of transitions) {
          this.cursor += 1;
          mutationChanges.push({
            cursor: String(this.cursor),
            entityKind: 'safetyEvent',
            entityId: transition.event.id,
            operation: 'upsert',
            payload: {
              ...transition.event,
              statusAfter: transition.statusAfter,
              ...(transition.expectedAttentionUpdatedAtMilliseconds === undefined
                ? {}
                : {
                    expectedAttentionUpdatedAtMilliseconds:
                      transition.expectedAttentionUpdatedAtMilliseconds,
                  }),
            },
          });
        }
        if (command.suppressPlan !== true && transitions.length === 0) {
          const authoritative = buildAuthoritativePlan({
            checkIn,
            decisionId: command.decisionId as Parameters<typeof buildAuthoritativePlan>[0]['decisionId'],
            revision: command.decisionRevision,
            duration: command.durationVariant,
            requestedOverride: command.requestedOverride,
            secondaryArea: checkIn.secondaryArea,
            attentionRequiredAreas: [],
            orderedOutcomes: [],
            createdAtMilliseconds: checkIn.completedAtMilliseconds ?? checkIn.startedAtMilliseconds,
          });
          if (!authoritative.ok || authoritative.value.kind !== 'approved') {
            rejectedMutationIds.add(mutation.mutationId);
            continue;
          }
          this.cursor += 1;
          mutationChanges.push({
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
        changes.push(...mutationChanges);
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

function parseDevelopmentCheckIn(value: unknown): CheckIn | undefined {
  if (
    !isRecord(value) ||
    !isRecord(value.dayContext) ||
    !Array.isArray(value.entries) ||
    !value.entries.every(isRecord) ||
    (value.correctionSource !== undefined && !isRecord(value.correctionSource))
  ) {
    return undefined;
  }
  const parsed = createCheckIn(value as CheckIn);
  return parsed.ok ? parsed.value : undefined;
}

function parseDevelopmentSafetyTransitions(
  checkIn: CheckIn,
  value: unknown,
): readonly SafetyMutation[] | undefined {
  if (value !== undefined && !Array.isArray(value)) return undefined;
  const candidates = value ?? [];
  const transitions: SafetyMutation[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.dayContext)) {
      return undefined;
    }
    const {
      statusAfter,
      expectedAttentionUpdatedAtMilliseconds,
      ...event
    } = candidate;
    const parsed = createSafetyMutation({
      event: event as SafetyEvent,
      statusAfter: statusAfter as SafetyMutation['statusAfter'],
      expectedAttentionUpdatedAtMilliseconds:
        expectedAttentionUpdatedAtMilliseconds as number | undefined,
    });
    if (!parsed.ok) return undefined;
    transitions.push(parsed.value);
  }
  const expectedEntries = checkIn.entries.filter((entry) =>
    checkIn.kind === 'attentionCorrection' ||
    entry.conditionalSafetyAnswer === 'yes' ||
    entry.conditionalSafetyAnswer === 'notSure'
  );
  if (transitions.length !== expectedEntries.length) return undefined;
  const matchedTransitionIds = new Set<string>();
  for (const entry of expectedEntries) {
    const expectedKind = checkIn.kind === 'normal'
      ? 'attentionEntered'
      : entry.conditionalSafetyAnswer === 'yes' ||
          entry.conditionalSafetyAnswer === 'notSure'
        ? 'attentionReaffirmedCorrection'
        : 'attentionClearedCorrection';
    const expectedStatus = expectedKind === 'attentionClearedCorrection'
      ? 'normal'
      : 'attentionRequired';
    const transition = transitions.find(({ event }) =>
      event.sourceCheckInEntryId === entry.id
    );
    if (
      transition === undefined ||
      matchedTransitionIds.has(transition.event.id) ||
      transition.event.area !== entry.area ||
      transition.event.kind !== expectedKind ||
      transition.statusAfter !== expectedStatus
    ) {
      return undefined;
    }
    matchedTransitionIds.add(transition.event.id);
  }
  return transitions;
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
