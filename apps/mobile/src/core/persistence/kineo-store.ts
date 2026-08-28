import type {
  AttentionState,
  CheckIn,
  LocalDay,
  ProfileState,
  SafetyEvent,
  SafetyEventId,
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
import type {
  AreaResponse,
  BodyArea,
  ChangeReport,
  CheckInId,
  MovementComfort,
  RoutineLevel,
  RoutineStatus,
} from '../domain/selection-domain';

export type AreaHistoryRecord = Readonly<{
  area: BodyArea;
  localDay: LocalDay;
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  routine?: Readonly<{
    sessionId: RoutineSessionId;
    status: RoutineStatus;
    deliveredLevel: RoutineLevel;
    wasIncluded: boolean;
    response?: AreaResponse;
  }>;
}>;

export type PauseTodayHistoryRecord = Readonly<{
  localDay: LocalDay;
  areas: readonly BodyArea[];
}>;

export interface KineoStore {
  loadProfileState(): Promise<PersistenceResult<ProfileState | undefined>>;
  saveProfileState(state: ProfileState): Promise<PersistenceResult<void>>;
  loadCheckIn(id: CheckInId): Promise<PersistenceResult<CheckIn | undefined>>;
  loadLatestCheckInDraft(
    kind: CheckIn['kind'],
  ): Promise<PersistenceResult<CheckIn | undefined>>;
  saveCheckInDraft(checkIn: CheckIn): Promise<PersistenceResult<void>>;
  abandonCheckInDraft(id: CheckInId): Promise<PersistenceResult<void>>;
  completeCheckIn(
    checkIn: CheckIn,
    safetyMutations: readonly SafetyMutation[],
  ): Promise<PersistenceResult<void>>;
  applySafetyMutation(mutation: SafetyMutation): Promise<PersistenceResult<void>>;
  appendSelectionDecision(
    decision: SelectionDecision,
  ): Promise<PersistenceResult<void>>;
  loadLatestSelectionDecision(
    checkInId: CheckInId,
  ): Promise<PersistenceResult<SelectionDecision | undefined>>;
  loadLatestUnconsumedSelectionDecision(): Promise<
    PersistenceResult<SelectionDecision | undefined>
  >;
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
  hasFeedbackForRoutine(
    id: RoutineSessionId,
  ): Promise<PersistenceResult<boolean>>;
  loadAreaHistory(): Promise<PersistenceResult<readonly AreaHistoryRecord[]>>;
  loadPauseTodayHistory(): Promise<
    PersistenceResult<readonly PauseTodayHistoryRecord[]>
  >;
  loadAttentionStates(): Promise<
    PersistenceResult<readonly AttentionState[]>
  >;
  loadSafetyEvent(id: SafetyEventId): Promise<PersistenceResult<SafetyEvent | undefined>>;
  resetHistory(): Promise<PersistenceResult<void>>;
}
