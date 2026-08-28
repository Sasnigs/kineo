import { describe, expect, it } from '@jest/globals';

import parityFixture from '../../testing/parity-fixtures/active-history-v1.json';
import configurationFixture from '../../testing/parity-fixtures/active-unlock-configuration-v1.json';
import {
  areaResponses,
  bodyAreas,
  routineLevels,
  routineStatuses,
  terminalRoutineStatuses,
  type AreaResponse,
  type BodyArea,
  type RoutineLevel,
  type RoutineStatus,
} from '../domain/selection-domain';
import {
  activeHistoryReductionErrors,
  createActiveHistoryState,
  createActiveUnlockConfiguration,
  isActiveUnlocked,
  prototypeActiveUnlockConfiguration,
  reduceActiveHistory,
  type ActiveHistoryReductionError,
  type ActiveHistoryState,
  type RoutineAreaOutcome,
} from './active-history';

function requireMember<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): Values[number] {
  if (!values.includes(candidate as Values[number])) {
    throw new Error(`Invalid parity fixture value: ${candidate}`);
  }
  return candidate as Values[number];
}

function historyFrom(
  candidate: (typeof parityFixture)[number]['history'],
): ActiveHistoryState {
  const result = createActiveHistoryState({
    area: requireMember(bodyAreas, candidate.area) as BodyArea,
    qualifyingOutcomeCount: candidate.qualifyingOutcomeCount,
    mostRecentRecordedResponse:
      candidate.mostRecentRecordedResponse === undefined
        ? undefined
        : (requireMember(
            areaResponses,
            candidate.mostRecentRecordedResponse,
          ) as AreaResponse),
  });
  if (!result.ok) {
    throw new Error('The shared Active-history fixture has invalid state.');
  }
  return result.value;
}

function outcomeFrom(
  candidate: (typeof parityFixture)[number]['outcome'],
): RoutineAreaOutcome {
  return {
    area: requireMember(bodyAreas, candidate.area) as BodyArea,
    routineStatus: requireMember(
      routineStatuses,
      candidate.routineStatus,
    ) as RoutineStatus,
    deliveredLevel: requireMember(
      routineLevels,
      candidate.deliveredLevel,
    ) as RoutineLevel,
    response:
      candidate.response === undefined
        ? undefined
        : (requireMember(areaResponses, candidate.response) as AreaResponse),
    wasIncludedInDeliveredRoutine: candidate.wasIncludedInDeliveredRoutine,
  };
}

describe('Active history parity', () => {
  it.each(parityFixture)('$name', (testCase) => {
    const result = reduceActiveHistory(
      historyFrom(testCase.history),
      outcomeFrom(testCase.outcome),
    );

    if (testCase.expectedError !== undefined) {
      expect(result).toEqual({
        ok: false,
        error: requireMember(
          activeHistoryReductionErrors,
          testCase.expectedError,
        ) as ActiveHistoryReductionError,
      });
      return;
    }

    expect(result).toEqual({
      ok: true,
      value: historyFrom(testCase.expectedHistory),
    });
  });

  it('covers every shared reducer error', () => {
    const fixtureErrors = parityFixture.flatMap(({ expectedError }) =>
      expectedError === undefined ? [] : [expectedError],
    );
    expect(new Set(fixtureErrors)).toEqual(
      new Set(activeHistoryReductionErrors.filter((error) => error !== 'qualifyingCountOverflow')),
    );
  });

  it('follows the full terminal outcome matrix', () => {
    const startingCount = 1;
    const qualifyingIncrement = 1;
    const responses: readonly (AreaResponse | undefined)[] = [
      undefined,
      ...areaResponses,
    ];

    for (const routineStatus of terminalRoutineStatuses) {
      for (const deliveredLevel of routineLevels) {
        for (const response of responses) {
          const previousResult = createActiveHistoryState({
            area: 'neck',
            qualifyingOutcomeCount: startingCount,
            mostRecentRecordedResponse: 'same',
          });
          expect(previousResult.ok).toBe(true);
          if (!previousResult.ok) {
            continue;
          }
          const result = reduceActiveHistory(previousResult.value, {
            area: 'neck',
            routineStatus,
            deliveredLevel,
            response,
            wasIncludedInDeliveredRoutine: true,
          });
          expect(result.ok).toBe(true);
          if (!result.ok) {
            continue;
          }
          const qualifies =
            routineStatus === 'completed' &&
            (deliveredLevel === 'gentle' || deliveredLevel === 'balanced') &&
            (response === 'better' || response === 'same');
          const expectedCount =
            response === 'worse'
              ? 0
              : qualifies
                ? startingCount + qualifyingIncrement
                : startingCount;

          expect(result.value.qualifyingOutcomeCount).toBe(expectedCount);
          expect(result.value.mostRecentRecordedResponse).toBe(
            response ?? 'same',
          );
        }
      }
    }
  });

  it('rejects invalid state and count overflow', () => {
    expect(
      createActiveHistoryState({
        area: 'neck',
        qualifyingOutcomeCount: -1,
      }),
    ).toEqual({ ok: false, error: 'invalidQualifyingOutcomeCount' });
    expect(
      createActiveHistoryState({
        area: 'neck',
        qualifyingOutcomeCount: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toEqual({ ok: false, error: 'invalidQualifyingOutcomeCount' });

    const maximumState = createActiveHistoryState({
      area: 'neck',
      qualifyingOutcomeCount: Number.MAX_SAFE_INTEGER,
    });
    expect(maximumState.ok).toBe(true);
    if (!maximumState.ok) {
      return;
    }
    expect(
      reduceActiveHistory(maximumState.value, {
        area: 'neck',
        routineStatus: 'completed',
        deliveredLevel: 'gentle',
        response: 'better',
        wasIncludedInDeliveredRoutine: true,
      }),
    ).toEqual({ ok: false, error: 'qualifyingCountOverflow' });
  });

  it('unlocks only at the configured threshold', () => {
    expect(prototypeActiveUnlockConfiguration).toEqual(configurationFixture);
    const belowThreshold = createActiveHistoryState({
      area: 'neck',
      qualifyingOutcomeCount:
        prototypeActiveUnlockConfiguration.qualifyingOutcomeCountRequired - 1,
    });
    const atThreshold = createActiveHistoryState({
      area: 'neck',
      qualifyingOutcomeCount:
        prototypeActiveUnlockConfiguration.qualifyingOutcomeCountRequired,
    });
    expect(belowThreshold.ok).toBe(true);
    expect(atThreshold.ok).toBe(true);
    if (!belowThreshold.ok || !atThreshold.ok) {
      return;
    }

    expect(isActiveUnlocked(belowThreshold.value)).toBe(false);
    expect(isActiveUnlocked(atThreshold.value)).toBe(true);
  });

  it('preserves qualifying sequences across skipped and incomplete feedback', () => {
    const initialState = createActiveHistoryState({
      area: 'neck',
      qualifyingOutcomeCount: 0,
    });
    expect(initialState.ok).toBe(true);
    if (!initialState.ok) {
      return;
    }

    const reduce = (
      previous: ActiveHistoryState,
      routineStatus: RoutineStatus,
      deliveredLevel: RoutineLevel,
      response?: AreaResponse,
    ) =>
      reduceActiveHistory(previous, {
        area: 'neck',
        routineStatus,
        deliveredLevel,
        response,
        wasIncludedInDeliveredRoutine: true,
      });

    const first = reduce(initialState.value, 'completed', 'gentle', 'better');
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const skipped = reduce(first.value, 'completed', 'balanced');
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) {
      return;
    }
    const incomplete = reduce(skipped.value, 'stopped', 'balanced', 'same');
    expect(incomplete.ok).toBe(true);
    if (!incomplete.ok) {
      return;
    }
    const second = reduce(incomplete.value, 'completed', 'balanced', 'same');
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    const reset = reduce(second.value, 'abandoned', 'active', 'worse');
    expect(reset.ok).toBe(true);
    if (!reset.ok) {
      return;
    }

    expect(first.value.qualifyingOutcomeCount).toBe(1);
    expect(skipped.value).toEqual(first.value);
    expect(incomplete.value.qualifyingOutcomeCount).toBe(
      first.value.qualifyingOutcomeCount,
    );
    expect(incomplete.value.mostRecentRecordedResponse).toBe('same');
    expect(second.value.qualifyingOutcomeCount).toBe(
      configurationFixture.qualifyingOutcomeCountRequired,
    );
    expect(isActiveUnlocked(second.value)).toBe(true);
    expect(reset.value.qualifyingOutcomeCount).toBe(0);
    expect(reset.value.mostRecentRecordedResponse).toBe('worse');
  });

  it('copies and freezes validated and reduced history state', () => {
    const mutableInput = {
      area: 'neck' as const,
      qualifyingOutcomeCount: 1,
      mostRecentRecordedResponse: 'same' as const,
    };
    const state = createActiveHistoryState(mutableInput);
    expect(state.ok).toBe(true);
    if (!state.ok) {
      return;
    }
    mutableInput.qualifyingOutcomeCount = -1;

    expect(state.value.qualifyingOutcomeCount).toBe(1);
    expect(Object.isFrozen(state.value)).toBe(true);

    const reduced = reduceActiveHistory(state.value, {
      area: 'neck',
      routineStatus: 'completed',
      deliveredLevel: 'gentle',
      response: 'better',
      wasIncludedInDeliveredRoutine: true,
    });
    expect(reduced.ok).toBe(true);
    if (!reduced.ok) {
      return;
    }
    expect(Object.isFrozen(reduced.value)).toBe(true);
  });

  it('rejects invalid unlock thresholds and freezes valid configuration', () => {
    const zeroThreshold = 0;
    const negativeThreshold = -1;
    const fractionalThreshold = 1.5;
    const unsafeThreshold = Number.MAX_SAFE_INTEGER + 1;
    const invalidThresholds = [
      zeroThreshold,
      negativeThreshold,
      fractionalThreshold,
      unsafeThreshold,
    ];
    for (const qualifyingOutcomeCountRequired of invalidThresholds) {
      expect(
        createActiveUnlockConfiguration({
          qualifyingOutcomeCountRequired,
          qualifyingLevels: ['gentle', 'balanced'],
          qualifyingResponses: ['better', 'same'],
        }),
      ).toEqual({ ok: false, error: 'invalidQualifyingOutcomeCount' });
    }

    expect(Object.isFrozen(prototypeActiveUnlockConfiguration)).toBe(true);
    expect(
      Object.isFrozen(prototypeActiveUnlockConfiguration.qualifyingLevels),
    ).toBe(true);
    expect(
      Object.isFrozen(prototypeActiveUnlockConfiguration.qualifyingResponses),
    ).toBe(true);
  });
});
