import type { RoutineSession } from '../persistence/routine-persistence-domain';
import type { BodyArea } from '../domain/selection-domain';
import type { PersistenceError } from '../persistence/persistence-contract';

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
  | Readonly<{ kind: 'unfinishedRoutine'; session: RoutineSession }>
  | Readonly<{ kind: 'today'; primaryArea: BodyArea }>;

export type ProductFlowError =
  | Readonly<{ code: 'invalidState' }>
  | Readonly<{ code: 'invalidData' }>
  | Readonly<{ code: 'persistence'; cause: PersistenceError }>;

export type ProductResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: ProductFlowError }>;
