import {
  terminalRoutineStatuses,
  type AreaResponse,
  type BodyArea,
  type RoutineLevel,
  type RoutineStatus,
} from '../domain/selection-domain';
import type { Result } from '../shared/result';

export type ActiveUnlockConfigurationInput = Readonly<{
  qualifyingOutcomeCountRequired: number;
  qualifyingLevels: readonly RoutineLevel[];
  qualifyingResponses: readonly AreaResponse[];
}>;

declare const activeUnlockConfigurationBrand: unique symbol;
export type ActiveUnlockConfiguration = ActiveUnlockConfigurationInput & {
  readonly [activeUnlockConfigurationBrand]: 'ActiveUnlockConfiguration';
};

export type ActiveUnlockConfigurationError = 'invalidQualifyingOutcomeCount';

const prototypeQualifyingOutcomeCountRequired = 2;

function validatedConfiguration(
  input: ActiveUnlockConfigurationInput,
): ActiveUnlockConfiguration {
  return Object.freeze({
    qualifyingOutcomeCountRequired: input.qualifyingOutcomeCountRequired,
    qualifyingLevels: Object.freeze([...input.qualifyingLevels]),
    qualifyingResponses: Object.freeze([...input.qualifyingResponses]),
  }) as ActiveUnlockConfiguration;
}

export function createActiveUnlockConfiguration(
  input: ActiveUnlockConfigurationInput,
): Result<ActiveUnlockConfiguration, ActiveUnlockConfigurationError> {
  if (
    !Number.isSafeInteger(input.qualifyingOutcomeCountRequired) ||
    input.qualifyingOutcomeCountRequired <= 0
  ) {
    return { ok: false, error: 'invalidQualifyingOutcomeCount' };
  }

  return { ok: true, value: validatedConfiguration(input) };
}

export const prototypeActiveUnlockConfiguration = validatedConfiguration({
  qualifyingOutcomeCountRequired: prototypeQualifyingOutcomeCountRequired,
  qualifyingLevels: ['gentle', 'balanced'],
  qualifyingResponses: ['better', 'same'],
});

declare const activeHistoryStateBrand: unique symbol;
export type ActiveHistoryState = Readonly<{
  area: BodyArea;
  qualifyingOutcomeCount: number;
  mostRecentRecordedResponse?: AreaResponse;
  readonly [activeHistoryStateBrand]: 'ActiveHistoryState';
}>;

export type ActiveHistoryStateInput = Readonly<{
  area: BodyArea;
  qualifyingOutcomeCount: number;
  mostRecentRecordedResponse?: AreaResponse;
}>;

export type ActiveHistoryValidationError = 'invalidQualifyingOutcomeCount';

export type RoutineAreaOutcome = Readonly<{
  area: BodyArea;
  routineStatus: RoutineStatus;
  deliveredLevel: RoutineLevel;
  response?: AreaResponse;
  wasIncludedInDeliveredRoutine: boolean;
}>;

export const activeHistoryReductionErrors = [
  'areaMismatch',
  'areaNotIncluded',
  'nonterminalRoutine',
  'qualifyingCountOverflow',
] as const;
export type ActiveHistoryReductionError =
  (typeof activeHistoryReductionErrors)[number];

const resetQualifyingOutcomeCount = 0;
const qualifyingOutcomeIncrement = 1;
const terminalRoutineStatusSet: ReadonlySet<RoutineStatus> = new Set(
  terminalRoutineStatuses,
);

function validatedState(input: ActiveHistoryStateInput): ActiveHistoryState {
  return Object.freeze({
    area: input.area,
    qualifyingOutcomeCount: input.qualifyingOutcomeCount,
    mostRecentRecordedResponse: input.mostRecentRecordedResponse,
  }) as ActiveHistoryState;
}

export function createActiveHistoryState(
  input: ActiveHistoryStateInput,
): Result<ActiveHistoryState, ActiveHistoryValidationError> {
  if (
    !Number.isSafeInteger(input.qualifyingOutcomeCount) ||
    input.qualifyingOutcomeCount < resetQualifyingOutcomeCount
  ) {
    return { ok: false, error: 'invalidQualifyingOutcomeCount' };
  }

  return { ok: true, value: validatedState(input) };
}

export function isActiveUnlocked(
  state: ActiveHistoryState,
  configuration: ActiveUnlockConfiguration = prototypeActiveUnlockConfiguration,
): boolean {
  return (
    state.qualifyingOutcomeCount >=
    configuration.qualifyingOutcomeCountRequired
  );
}

export function reduceActiveHistory(
  previous: ActiveHistoryState,
  outcome: RoutineAreaOutcome,
  configuration: ActiveUnlockConfiguration = prototypeActiveUnlockConfiguration,
): Result<ActiveHistoryState, ActiveHistoryReductionError> {
  if (previous.area !== outcome.area) {
    return { ok: false, error: 'areaMismatch' };
  }
  if (!outcome.wasIncludedInDeliveredRoutine) {
    return { ok: false, error: 'areaNotIncluded' };
  }
  if (!terminalRoutineStatusSet.has(outcome.routineStatus)) {
    return { ok: false, error: 'nonterminalRoutine' };
  }

  if (outcome.response === 'worse') {
    return {
      ok: true,
      value: validatedState({
        area: previous.area,
        qualifyingOutcomeCount: resetQualifyingOutcomeCount,
        mostRecentRecordedResponse: 'worse',
      }),
    };
  }

  const mostRecentRecordedResponse =
    outcome.response ?? previous.mostRecentRecordedResponse;
  const qualifies =
    outcome.routineStatus === 'completed' &&
    configuration.qualifyingLevels.includes(outcome.deliveredLevel) &&
    outcome.response !== undefined &&
    configuration.qualifyingResponses.includes(outcome.response);

  if (!qualifies) {
    return {
      ok: true,
      value: validatedState({
        area: previous.area,
        qualifyingOutcomeCount: previous.qualifyingOutcomeCount,
        mostRecentRecordedResponse,
      }),
    };
  }

  const qualifyingOutcomeCount =
    previous.qualifyingOutcomeCount + qualifyingOutcomeIncrement;
  if (!Number.isSafeInteger(qualifyingOutcomeCount)) {
    return { ok: false, error: 'qualifyingCountOverflow' };
  }

  return {
    ok: true,
    value: validatedState({
      area: previous.area,
      qualifyingOutcomeCount,
      mostRecentRecordedResponse,
    }),
  };
}
