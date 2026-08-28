import type { RoutineSessionId } from '../../core/content/routine-session-snapshot';
import type { CheckInId } from '../../core/domain/selection-domain';
import type { SelectionDecision } from '../../core/persistence/decision-persistence-domain';
import type { KineoStore } from '../../core/persistence/kineo-store';
import type { PersistenceResult } from '../../core/persistence/persistence-contract';
import type {
  AttentionState,
  CheckIn,
  LocalDay,
  ProfileState,
  SafetyEvent,
  SafetyEventId,
  SafetyMutation,
} from '../../core/persistence/persistence-domain';
import type {
  FeedbackSubmission,
  PauseTodayEvent,
  RoutineCheckpoint,
  RoutineEvent,
  RoutineSession,
} from '../../core/persistence/routine-persistence-domain';

type ProtectionCheck = () => Promise<PersistenceResult<void>>;
type PoisonCleanup = () => Promise<void>;
type DeleteStore = () => Promise<PersistenceResult<void>>;

export interface KineoPersistence extends KineoStore {
  deleteAllData(): Promise<PersistenceResult<void>>;
}

const poisonedResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'storageProtectionFailed' as const }),
});

/**
 * Enforces file protection after every committed write. A failed verification
 * poisons this store instance so callers cannot continue on uncertain storage.
 */
export class ProtectedKineoStore implements KineoPersistence {
  private state: 'usable' | 'poisoned' | 'deleted' = 'usable';

  constructor(
    private readonly base: KineoStore,
    private readonly verifyProtection: ProtectionCheck,
    private readonly cleanupAfterPoison: PoisonCleanup,
    private readonly deleteStore: DeleteStore,
  ) {}

  loadProfileState(): Promise<PersistenceResult<ProfileState | undefined>> {
    return this.read(() => this.base.loadProfileState());
  }

  saveProfileState(state: ProfileState): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.saveProfileState(state));
  }

  loadCheckIn(id: CheckInId): Promise<PersistenceResult<CheckIn | undefined>> {
    return this.read(() => this.base.loadCheckIn(id));
  }

  loadLatestCheckInDraft(kind: CheckIn['kind']): Promise<PersistenceResult<CheckIn | undefined>> {
    return this.read(() => this.base.loadLatestCheckInDraft(kind));
  }

  saveCheckInDraft(checkIn: CheckIn): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.saveCheckInDraft(checkIn));
  }

  completeCheckIn(checkIn: CheckIn, safetyMutations: readonly SafetyMutation[]): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.completeCheckIn(checkIn, safetyMutations));
  }

  applySafetyMutation(mutation: SafetyMutation): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.applySafetyMutation(mutation));
  }

  appendSelectionDecision(decision: SelectionDecision): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.appendSelectionDecision(decision));
  }

  loadLatestSelectionDecision(checkInId: CheckInId): Promise<PersistenceResult<SelectionDecision | undefined>> {
    return this.read(() => this.base.loadLatestSelectionDecision(checkInId));
  }

  loadLatestUnconsumedSelectionDecision(): Promise<PersistenceResult<SelectionDecision | undefined>> {
    return this.read(() => this.base.loadLatestUnconsumedSelectionDecision());
  }

  recordPauseToday(event: PauseTodayEvent): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.recordPauseToday(event));
  }

  loadPauseToday(localDay: LocalDay): Promise<PersistenceResult<PauseTodayEvent | undefined>> {
    return this.read(() => this.base.loadPauseToday(localDay));
  }

  createRoutine(session: RoutineSession): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.createRoutine(session));
  }

  loadRoutineSession(id: RoutineSessionId): Promise<PersistenceResult<RoutineSession | undefined>> {
    return this.read(() => this.base.loadRoutineSession(id));
  }

  loadNonterminalRoutine(): Promise<PersistenceResult<RoutineSession | undefined>> {
    return this.read(() => this.base.loadNonterminalRoutine());
  }

  recordRoutineEvent(event: RoutineEvent, checkpoint: RoutineCheckpoint): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.recordRoutineEvent(event, checkpoint));
  }

  loadRoutineEvents(id: RoutineSessionId): Promise<PersistenceResult<readonly RoutineEvent[]>> {
    return this.read(() => this.base.loadRoutineEvents(id));
  }

  submitFeedback(submission: FeedbackSubmission): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.submitFeedback(submission));
  }

  hasFeedbackForRoutine(id: RoutineSessionId): Promise<PersistenceResult<boolean>> {
    return this.read(() => this.base.hasFeedbackForRoutine(id));
  }

  loadAttentionStates(): Promise<PersistenceResult<readonly AttentionState[]>> {
    return this.read(() => this.base.loadAttentionStates());
  }

  loadSafetyEvent(id: SafetyEventId): Promise<PersistenceResult<SafetyEvent | undefined>> {
    return this.read(() => this.base.loadSafetyEvent(id));
  }

  resetHistory(): Promise<PersistenceResult<void>> {
    return this.write(() => this.base.resetHistory());
  }

  async deleteAllData(): Promise<PersistenceResult<void>> {
    if (this.state === 'deleted') return { ok: false, error: { code: 'storeDeleted' } };
    if (this.state === 'poisoned') return poisonedResult;
    this.state = 'deleted';
    return this.deleteStore();
  }

  private async read<Value>(operation: () => Promise<PersistenceResult<Value>>): Promise<PersistenceResult<Value>> {
    return this.unavailableResult() ?? operation();
  }

  private async write(operation: () => Promise<PersistenceResult<void>>): Promise<PersistenceResult<void>> {
    const unavailable = this.unavailableResult<void>();
    if (unavailable !== undefined) return unavailable;
    const result = await operation();
    if (!result.ok) return result;
    const protection = await this.verifyProtection();
    if (protection.ok) return result;
    this.state = 'poisoned';
    try {
      await this.cleanupAfterPoison();
    } catch {
      // The protection error remains primary; this instance is already unusable.
    }
    return protection;
  }

  private unavailableResult<Value>(): PersistenceResult<Value> | undefined {
    if (this.state === 'poisoned') return poisonedResult;
    if (this.state === 'deleted') return { ok: false, error: { code: 'storeDeleted' } };
    return undefined;
  }
}
