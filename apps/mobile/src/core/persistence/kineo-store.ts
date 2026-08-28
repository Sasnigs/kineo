import type { CheckInId } from '../domain/selection-domain';
import type {
  AttentionState,
  CheckIn,
  LocalDay,
  ProfileState,
  SafetyMutation,
} from './persistence-domain';
import type { PersistenceResult } from './persistence-contract';
import type { SelectionDecision } from './decision-persistence-domain';
import type {
  FeedbackSubmission,
  PauseTodayEvent,
  RoutineCheckpoint,
  RoutineEvent,
  RoutineSession,
} from './routine-persistence-domain';
import type { RoutineSessionId } from '../content/routine-session-snapshot';

export interface KineoStore {
  loadProfileState(): Promise<PersistenceResult<ProfileState | undefined>>;
  saveProfileState(state: ProfileState): Promise<PersistenceResult<void>>;
  loadCheckIn(id: CheckInId): Promise<PersistenceResult<CheckIn | undefined>>;
  saveCheckInDraft(checkIn: CheckIn): Promise<PersistenceResult<void>>;
  completeCheckIn(
    checkIn: CheckIn,
    safetyMutations: readonly SafetyMutation[],
  ): Promise<PersistenceResult<void>>;
  appendSelectionDecision(
    decision: SelectionDecision,
  ): Promise<PersistenceResult<void>>;
  loadLatestSelectionDecision(
    checkInId: CheckInId,
  ): Promise<PersistenceResult<SelectionDecision | undefined>>;
  recordPauseToday(event: PauseTodayEvent): Promise<PersistenceResult<void>>;
  loadPauseToday(localDay: LocalDay): Promise<PersistenceResult<PauseTodayEvent | undefined>>;
  createRoutine(session: RoutineSession): Promise<PersistenceResult<void>>;
  loadRoutineSession(id: RoutineSessionId): Promise<PersistenceResult<RoutineSession | undefined>>;
  loadNonterminalRoutine(): Promise<PersistenceResult<RoutineSession | undefined>>;
  recordRoutineEvent(
    event: RoutineEvent,
    checkpoint: RoutineCheckpoint,
  ): Promise<PersistenceResult<void>>;
  loadRoutineEvents(id: RoutineSessionId): Promise<PersistenceResult<readonly RoutineEvent[]>>;
  submitFeedback(submission: FeedbackSubmission): Promise<PersistenceResult<void>>;
  loadAttentionStates(): Promise<
    PersistenceResult<readonly AttentionState[]>
  >;
  resetHistory(): Promise<PersistenceResult<void>>;
}
