import type { CheckInId } from '../domain/selection-domain';
import type {
  AttentionState,
  CheckIn,
  ProfileState,
  SafetyMutation,
} from './persistence-domain';
import type { PersistenceResult } from './persistence-contract';
import type { SelectionDecision } from './decision-persistence-domain';

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
  loadAttentionStates(): Promise<
    PersistenceResult<readonly AttentionState[]>
  >;
  resetHistory(): Promise<PersistenceResult<void>>;
}
