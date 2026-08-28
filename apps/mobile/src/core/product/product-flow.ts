import type {
  PresentedAlternative,
  PresentedRoutineItem,
  RoutineSessionId,
} from '../content/routine-session-snapshot';
import type {
  BodyArea,
  ChangeReport,
  CheckInEntryId,
  CheckInId,
  ConditionalSafetyAnswer,
  DurationVariant,
  MovementComfort,
  RoutineLevel,
  RoutineStatus,
  SelectionDecisionId,
} from '../domain/selection-domain';
import type { PersistenceError } from '../persistence/persistence-contract';
import type { LocalDayContext } from '../persistence/persistence-domain';

export type CheckInDraft = Readonly<{
  checkInId: CheckInId;
  primaryEntryId: CheckInEntryId;
  primaryArea: BodyArea;
  secondaryEntryId?: CheckInEntryId;
  secondaryArea?: BodyArea;
  startedAtMilliseconds: number;
  dayContext: LocalDayContext;
}>;

export type AreaCheckInAnswers = Readonly<{
  area: BodyArea;
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  conditionalSafetyAnswer?: ConditionalSafetyAnswer;
}>;

export type PlanPresentation = Readonly<{
  decisionId: SelectionDecisionId;
  checkInId: CheckInId;
  primaryArea: BodyArea;
  includedAreas: readonly BodyArea[];
  omittedSecondaryArea?: BodyArea;
  recommendedLevel: RoutineLevel;
  selectedLevel: RoutineLevel;
  deliveredLevel: RoutineLevel;
  duration: DurationVariant;
  explanationKeys: readonly string[];
  itemCount: number;
  nominalSeconds: number;
  pauseTodayAvailable: boolean;
}>;

export type CheckInResult =
  | Readonly<{
      kind: 'attentionRequired';
      area: BodyArea;
      expectedAttentionUpdatedAtMilliseconds: number;
    }>
  | Readonly<{ kind: 'plan'; plan: PlanPresentation }>;

export type RoutinePresentation = Readonly<{
  sessionId: RoutineSessionId;
  primaryArea: BodyArea;
  includedAreas: readonly BodyArea[];
  selectedLevel: RoutineLevel;
  deliveredLevel: RoutineLevel;
  duration: DurationVariant;
  status: RoutineStatus;
  currentStepIndex: number;
  totalStepCount: number;
  currentItem?: PresentedRoutineItem;
  selectedAlternative?: PresentedAlternative;
  stepElapsedMilliseconds: number;
  contentAvailable: boolean;
}>;

export type OnboardingProgress =
  | Readonly<{ step: 'welcome' }>
  | Readonly<{ step: 'primaryArea' }>
  | Readonly<{
      step: 'secondaryArea';
      primaryArea: BodyArea;
      selectedArea?: BodyArea;
    }>
  | Readonly<{ step: 'safetyBoundary'; primaryArea: BodyArea }>
  | Readonly<{ step: 'firstCheckIn'; primaryArea: BodyArea }>;

export type ProductStartState =
  | Readonly<{ kind: 'onboarding'; progress: OnboardingProgress }>
  | Readonly<{
      kind: 'attentionRequired';
      area: BodyArea;
      expectedAttentionUpdatedAtMilliseconds: number;
    }>
  | Readonly<{ kind: 'unfinishedCheckIn'; draft: CheckInDraft }>
  | Readonly<{ kind: 'unfinishedPlan'; plan: PlanPresentation }>
  | Readonly<{ kind: 'unfinishedRoutine'; routine: RoutinePresentation }>
  | Readonly<{ kind: 'today'; primaryArea: BodyArea }>;

export type ProductFlowError =
  | Readonly<{ code: 'invalidState' }>
  | Readonly<{ code: 'invalidData' }>
  | Readonly<{ code: 'contentUnavailable' }>
  | Readonly<{ code: 'attentionRequired'; areas: readonly BodyArea[] }>
  | Readonly<{ code: 'persistence'; cause: PersistenceError }>;

export type ProductResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: ProductFlowError }>;
