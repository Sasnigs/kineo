import { createPendingMutation, type SyncCommand } from '../../core/account/sync-contract';
import type {
  SyncLocalRepository,
  SyncModule,
  SyncOutbox,
} from '../../core/account/sync-module';
import type { KineoPersistence } from '../../core/persistence/kineo-store';
import { terminalRoutineStatuses } from '../../core/domain/selection-domain';
import type {
  PersistenceResult,
} from '../../core/persistence/persistence-contract';
import type { AccountLocalWriter, LocalAccountWrite } from './kineo-sqlite-account-writer';

const missingRemoteVersion = 0;
const initialDecisionRevision = 1;

export class AccountAwareKineoStore implements KineoPersistence {
  constructor(
    private readonly base: KineoPersistence,
    private readonly accountId: string,
    private readonly installationId: string,
    private readonly sync: SyncModule,
    private readonly repository: SyncLocalRepository & SyncOutbox,
    private readonly nextIdentifier: () => string,
    private readonly nowMilliseconds: () => number,
    private readonly allowDevelopmentReset: boolean,
    private readonly localWriter: AccountLocalWriter,
  ) {}

  loadProfileState: KineoPersistence['loadProfileState'] = () =>
    this.base.loadProfileState();

  async saveProfileState(
    state: Parameters<KineoPersistence['saveProfileState']>[0],
  ): Promise<PersistenceResult<void>> {
    return this.pushProfile(state);
  }

  loadCheckIn: KineoPersistence['loadCheckIn'] = (id) =>
    this.base.loadCheckIn(id);

  loadLatestCheckInDraft: KineoPersistence['loadLatestCheckInDraft'] = (kind) =>
    this.base.loadLatestCheckInDraft(kind);

  saveCheckInDraft: KineoPersistence['saveCheckInDraft'] = (checkIn) =>
    this.base.saveCheckInDraft(checkIn);

  abandonCheckInDraft: KineoPersistence['abandonCheckInDraft'] = (id) =>
    this.base.abandonCheckInDraft(id);

  async completeCheckIn(
    checkIn: Parameters<KineoPersistence['completeCheckIn']>[0],
    safetyMutations: Parameters<KineoPersistence['completeCheckIn']>[1],
  ): Promise<PersistenceResult<void>> {
    if (checkIn.kind === 'attentionCorrection') {
      const remote = await this.pushCommand({
        kind: 'submitCheckIn',
        checkIn,
        decisionId: this.nextIdentifier(),
        decisionRevision: initialDecisionRevision,
        durationVariant: 'standard',
        suppressPlan: true,
        attentionTransitions: safetyMutations.map((mutation) => ({
          ...mutation.event,
          statusAfter: mutation.statusAfter,
          expectedAttentionUpdatedAtMilliseconds: mutation.expectedAttentionUpdatedAtMilliseconds,
        })),
      }, true);
      return remote;
    }
    // Normal submissions were already authorized by PlanAuthority. Do not replay
    // provisional safety IDs/timestamps over the authoritative projection.
    const remote = await this.repository.loadSynchronizedEntity('checkIn', checkIn.id);
    if (!remote.ok) return writeFailure();
    return equalDomainValues(remote.value, checkIn)
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'conflictingWrite' } };
  }

  async applySafetyMutation(
    mutation: Parameters<KineoPersistence['applySafetyMutation']>[0],
  ): Promise<PersistenceResult<void>> {
    const remote = await this.pushCommand({
      kind: 'applyAttentionTransition',
      transition: {
        ...mutation.event,
        statusAfter: mutation.statusAfter,
        expectedAttentionUpdatedAtMilliseconds: mutation.expectedAttentionUpdatedAtMilliseconds,
      },
    }, true);
    return remote;
  }

  appendSelectionDecision: KineoPersistence['appendSelectionDecision'] = async (decision) => {
    const remote = await this.repository.loadSynchronizedEntity('selectionDecision', decision.id);
    if (!remote.ok) return writeFailure();
    const envelope = isRecord(remote.value) ? remote.value : undefined;
    const canonical = isRecord(envelope?.canonicalDecision) ? envelope.canonicalDecision : envelope;
    if (canonical === undefined) return { ok: false, error: { code: 'conflictingWrite' } };
    const { createdAtMilliseconds: _serverCreatedAt, ...serverDecision } = canonical;
    const { createdAtMilliseconds: _localCreatedAt, ...localDecision } = decision;
    return equalDomainValues(serverDecision, localDecision)
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'conflictingWrite' } };
  };

  loadLatestSelectionDecision: KineoPersistence['loadLatestSelectionDecision'] = (checkInId) =>
    this.base.loadLatestSelectionDecision(checkInId);

  loadLatestUnconsumedSelectionDecision: KineoPersistence['loadLatestUnconsumedSelectionDecision'] = () =>
    this.base.loadLatestUnconsumedSelectionDecision();

  async recordPauseToday(
    event: Parameters<KineoPersistence['recordPauseToday']>[0],
  ): Promise<PersistenceResult<void>> {
    const remote = await this.pushCommand({
      kind: 'recordPauseToday',
      event,
    }, true);
    return remote;
  }

  loadPauseToday: KineoPersistence['loadPauseToday'] = (localDay) =>
    this.base.loadPauseToday(localDay);

  async createRoutine(
    session: Parameters<KineoPersistence['createRoutine']>[0],
  ): Promise<PersistenceResult<void>> {
    const decision = await this.base.loadLatestSelectionDecision(
      session.checkInId,
    );
    if (
      !decision.ok ||
      decision.value === undefined ||
      decision.value.id !== session.decisionId
    ) return writeFailure();
    const remote = await this.pushCommand({
      kind: 'startRoutine',
      decisionId: session.decisionId,
      decision: decision.value,
      routine: session,
    }, true);
    // Successful synchronization already committed the server session and its
    // ownership in the same local projection transaction.
    return remote;
  }

  loadRoutineSession: KineoPersistence['loadRoutineSession'] = async (id) => {
    const loaded = await this.base.loadRoutineSession(id);
    if (!loaded.ok || loaded.value === undefined ||
        terminalRoutineStatuses.some((status) => status === loaded.value?.status)) return loaded;
    const ownership = await this.requirePlaybackOwnership(id);
    return ownership.ok ? loaded : ownership;
  };

  loadNonterminalRoutine: KineoPersistence['loadNonterminalRoutine'] = async () => {
    const loaded = await this.base.loadNonterminalRoutine();
    if (!loaded.ok || loaded.value === undefined) return loaded;
    const ownership = await this.requirePlaybackOwnership(loaded.value.id);
    if (ownership.ok) return loaded;
    return ownership.error.code === 'conflictingWrite'
      ? { ok: true, value: undefined }
      : ownership;
  };

  async recordRoutineEvent(
    event: Parameters<KineoPersistence['recordRoutineEvent']>[0],
    checkpoint: Parameters<KineoPersistence['recordRoutineEvent']>[1],
  ): Promise<PersistenceResult<void>> {
    const ownership = await this.requirePlaybackOwnership(event.routineSessionId);
    if (!ownership.ok) return ownership;
    return this.pushCommand({
      kind: 'recordRoutineEvent',
      event: {
        ...event,
        expectedVersion: event.sequenceNumber,
        resultingStatus: checkpoint.status,
        resultingStepIndex: checkpoint.currentStepIndex,
        resultingStepElapsedMilliseconds: checkpoint.stepElapsedMilliseconds,
        ...(event.kind === 'started'
          ? { resultingStartedAtMilliseconds: event.occurredAtMilliseconds }
          : {}),
        resultingUpdatedAtMilliseconds: checkpoint.updatedAtMilliseconds,
        resultingEndedAtMilliseconds: checkpoint.endedAtMilliseconds,
      },
    }, false, (local) => local.recordRoutineEvent(event, checkpoint));
  }

  loadRoutineEvents: KineoPersistence['loadRoutineEvents'] = (id) =>
    this.base.loadRoutineEvents(id);

  async submitFeedback(
    submission: Parameters<KineoPersistence['submitFeedback']>[0],
  ): Promise<PersistenceResult<void>> {
    return this.pushCommand({
      kind: 'submitFeedback',
      submission,
    }, false, (local) => local.submitFeedback(submission));
  }

  hasFeedbackForRoutine: KineoPersistence['hasFeedbackForRoutine'] = (id) =>
    this.base.hasFeedbackForRoutine(id);

  loadAreaHistory: KineoPersistence['loadAreaHistory'] = () =>
    this.base.loadAreaHistory();

  loadPauseTodayHistory: KineoPersistence['loadPauseTodayHistory'] = () =>
    this.base.loadPauseTodayHistory();

  loadAttentionStates: KineoPersistence['loadAttentionStates'] = () =>
    this.base.loadAttentionStates();

  loadSafetyEvent: KineoPersistence['loadSafetyEvent'] = (id) =>
    this.base.loadSafetyEvent(id);

  resetHistory: KineoPersistence['resetHistory'] = () =>
    this.allowDevelopmentReset
      ? this.base.resetHistory()
      : Promise.resolve(writeFailure());

  deleteAllData: KineoPersistence['deleteAllData'] = () =>
    this.allowDevelopmentReset
      ? this.base.deleteAllData()
      : Promise.resolve(writeFailure());

  async synchronizeCurrentProfile(): Promise<PersistenceResult<void>> {
    const profile = await this.base.loadProfileState();
    if (!profile.ok || profile.value === undefined) {
      return profile.ok ? { ok: true, value: undefined } : profile;
    }
    return this.pushProfile(profile.value);
  }

  private async pushProfile(
    state: Parameters<KineoPersistence['saveProfileState']>[0],
  ): Promise<PersistenceResult<void>> {
    const remote = await this.repository.loadSynchronizedEntity(
      'profile',
      this.accountId,
    );
    if (!remote.ok) return writeFailure();
    const expectedVersion = isRecord(remote.value) &&
      typeof remote.value.version === 'number' &&
      Number.isSafeInteger(remote.value.version)
      ? remote.value.version
      : missingRemoteVersion;
    return this.pushCommand({
      kind: 'saveProfile',
      expectedVersion,
      profile: {
        adultAcknowledged: state.profile.adultAcknowledged,
        onboardingCompletedAtMilliseconds:
          state.profile.onboardingCompletedAtMilliseconds,
        primaryArea: state.profile.primaryArea,
        secondaryArea: state.profile.secondaryArea,
        safetyBoundaryVersion: state.profile.safetyBoundaryVersion,
        safetyAcknowledgedAtMilliseconds:
          state.profile.safetyAcknowledgedAtMilliseconds,
        routinePreference: state.profile.routinePreference,
        weeklyGoalDays: state.profile.weeklyGoalDays,
        telemetryChoice: state.profile.telemetryChoice,
        createdAtMilliseconds: state.profile.createdAtMilliseconds,
        updatedAtMilliseconds: state.profile.updatedAtMilliseconds,
      },
      reminderSettings: state.reminderSettings,
    }, true);
  }

  private async requirePlaybackOwnership(routineId: string): Promise<PersistenceResult<void>> {
    const remote = await this.repository.loadSynchronizedEntity('routineSession', routineId);
    if (!remote.ok) return writeFailure();
    return isRecord(remote.value) && remote.value.ownerInstallationId === this.installationId
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'conflictingWrite' } };
  }

  private async pushCommand(
    command: SyncCommand,
    requiresServerSuccess: boolean,
    localWrite?: LocalAccountWrite,
  ): Promise<PersistenceResult<void>> {
    const account = await this.repository.loadAccount();
    if (!account.ok || account.value === undefined) return writeFailure();
    const created = createPendingMutation({
      mutationId: this.nextIdentifier(),
      accountId: this.accountId,
      installationId: this.installationId,
      historyEpoch: account.value.historyEpoch,
      createdAtMilliseconds: this.nowMilliseconds(),
      command,
    });
    if (!created.ok) return writeFailure();
    if (localWrite !== undefined) {
      const committed = await this.localWriter.commit(created.value, localWrite);
      if (!committed.ok) return committed;
    } else {
      const enqueued = await this.repository.enqueue(created.value);
      if (!enqueued.ok) return writeFailure();
    }
    const pending = await this.repository.pendingMutations();
    if (!pending.ok) return writeFailure();
    const synchronized = await this.sync.synchronize(pending.value);
    if (synchronized.ok ||
        (!requiresServerSuccess && synchronized.error.code === 'offline')) {
      return { ok: true, value: undefined };
    }
    return synchronized.error.code === 'conflict'
      ? {
          ok: false,
          error: { code: 'conflictingWrite' },
        }
      : writeFailure();
  }
}

function writeFailure(): PersistenceResult<void> {
  return { ok: false, error: { code: 'writeFailed' } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// JSONB and local domain constructors need not retain object key order. Optional
// undefined values are absent from the wire; array ordering remains meaningful.
function equalDomainValues(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalDomainValues(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => equalDomainValues(left[key], right[key]));
}
