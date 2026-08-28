import { describe, expect, it } from '@jest/globals';

import parityFixture from '../../../../../Packages/KineoModules/Tests/KineoCoreTests/Fixtures/plan-selection-v1.json';
import {
  bodyAreas,
  changeReports,
  conditionalSafetyAnswers,
  movementComforts,
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
  routineLevels,
  routineLevelRanks,
  secondaryParticipations,
  type AreaRole,
  type BodyArea,
  type ChangeReport,
  type ConditionalSafetyAnswer,
  type MovementComfort,
  type RoutineLevel,
  type SelectionAreaCheckIn,
} from '../domain/selection-domain';
import {
  createActiveHistoryState,
  prototypeActiveUnlockConfiguration,
  type ActiveHistoryState,
} from './active-history';
import { selectAreaLevel } from './area-level-rule';
import {
  prototypeSelectionRulesVersion,
  selectPlan,
  type PlanSelectionRequest,
  type SelectionSafetySnapshot,
} from './plan-selector';

const catalogVersion = 'catalog-v1';
const validRevision = 1;
const primaryEntryIdValue = '00000000-0000-0000-0000-000000000003';
const secondaryEntryIdValue = '00000000-0000-0000-0000-000000000004';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A test fixture failed validation.');
  }
  return result.value;
}

function member<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): Values[number] {
  if (!values.includes(candidate as Values[number])) {
    throw new Error(`Invalid plan-selection fixture value: ${candidate}`);
  }
  return candidate as Values[number];
}

function entryId(role: AreaRole) {
  return required(
    parseCheckInEntryId(
      role === 'primary' ? primaryEntryIdValue : secondaryEntryIdValue,
    ),
  );
}

function checkIn(
  area: BodyArea,
  options: Readonly<{
    role?: AreaRole;
    changeReport?: ChangeReport;
    movementComfort?: MovementComfort;
    conditionalSafetyAnswer?: ConditionalSafetyAnswer;
  }> = {},
): SelectionAreaCheckIn {
  return {
    checkInEntryId: entryId(options.role ?? 'primary'),
    entryRevision: validRevision,
    area,
    changeReport: options.changeReport ?? 'similar',
    movementComfort: options.movementComfort ?? 'good',
    conditionalSafetyAnswer: options.conditionalSafetyAnswer,
  };
}

function normalSafety(): Record<BodyArea, SelectionSafetySnapshot> {
  return {
    neck: { area: 'neck', status: 'normal' },
    upperMidBack: { area: 'upperMidBack', status: 'normal' },
    lowerBack: { area: 'lowerBack', status: 'normal' },
  };
}

function request(
  overrides: Partial<PlanSelectionRequest> = {},
): PlanSelectionRequest {
  const primaryArea = overrides.primaryArea ?? 'neck';
  return {
    decisionId: required(
      parseSelectionDecisionId('00000000-0000-0000-0000-000000000001'),
    ),
    checkInId: required(
      parseCheckInId('00000000-0000-0000-0000-000000000002'),
    ),
    decisionRevision: validRevision,
    primaryArea,
    checkInsByArea: { [primaryArea]: checkIn(primaryArea) },
    safetyByArea: normalSafety(),
    historyByArea: {},
    duration: 'standard',
    rulesVersion: prototypeSelectionRulesVersion,
    catalogVersion,
    ...overrides,
  };
}

function unlockedHistory(area: BodyArea) {
  return required(
    createActiveHistoryState({
      area,
      qualifyingOutcomeCount:
        prototypeActiveUnlockConfiguration.qualifyingOutcomeCountRequired,
    }),
  );
}

function selected(result: ReturnType<typeof selectPlan>) {
  expect(result.kind).toBe('selected');
  if (result.kind !== 'selected') {
    throw new Error('Expected a selected plan.');
  }
  return result.plan;
}

function noPlan(result: ReturnType<typeof selectPlan>) {
  expect(result.kind).toBe('noPlan');
  if (result.kind !== 'noPlan') {
    throw new Error('Expected a no-plan result.');
  }
  return result;
}

function inputForLevel(level: RoutineLevel): Readonly<{
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  conditionalSafetyAnswer?: ConditionalSafetyAnswer;
  unlocked: boolean;
}> {
  switch (level) {
    case 'gentle':
      return {
        changeReport: 'worse',
        movementComfort: 'good',
        conditionalSafetyAnswer: 'no',
        unlocked: false,
      };
    case 'balanced':
      return {
        changeReport: 'similar',
        movementComfort: 'good',
        unlocked: false,
      };
    case 'active':
      return {
        changeReport: 'better',
        movementComfort: 'good',
        unlocked: true,
      };
  }
}

describe('Plan selector', () => {
  it.each(parityFixture)('matches shared parity: $name', (testCase) => {
    const fixtureRequest = testCase.request;
    const primaryArea = member(bodyAreas, fixtureRequest.primaryArea);
    const secondaryAreaValue = fixtureRequest.secondaryArea;
    const secondaryArea =
      secondaryAreaValue !== undefined
        ? member(bodyAreas, secondaryAreaValue)
        : undefined;
    const fixtureCheckIn = (
      area: BodyArea,
      role: AreaRole,
      value: {
        changeReport: string;
        movementComfort: string;
        conditionalSafetyAnswer?: string;
      },
    ) =>
      checkIn(area, {
        role,
        changeReport: member(changeReports, value.changeReport),
        movementComfort: member(movementComforts, value.movementComfort),
        conditionalSafetyAnswer:
          value.conditionalSafetyAnswer === undefined
            ? undefined
            : member(
                conditionalSafetyAnswers,
                value.conditionalSafetyAnswer,
              ),
      });
    const checkInsByArea: Partial<Record<BodyArea, SelectionAreaCheckIn>> = {
      [primaryArea]: fixtureCheckIn(
        primaryArea,
        'primary',
        fixtureRequest.primary,
      ),
    };
    const secondaryCheckIn = fixtureRequest.secondary;
    if (secondaryArea !== undefined && secondaryCheckIn !== undefined) {
      checkInsByArea[secondaryArea] = fixtureCheckIn(
        secondaryArea,
        'secondary',
        secondaryCheckIn,
      );
    }
    const safetyByArea = normalSafety();
    for (const area of fixtureRequest.safetyAttentionAreas) {
      const validArea = member(bodyAreas, area);
      safetyByArea[validArea] = {
        area: validArea,
        status: 'attentionRequired',
      };
    }
    const historyByArea: Partial<
      Record<BodyArea, ReturnType<typeof unlockedHistory>>
    > = {};
    for (const area of fixtureRequest.unlockedAreas) {
      const validArea = member(bodyAreas, area);
      historyByArea[validArea] = unlockedHistory(validArea);
    }
    const result = selectPlan(
      request({
        primaryArea,
        secondaryArea,
        secondaryParticipation:
          fixtureRequest.secondaryParticipation !== undefined
            ? member(
                secondaryParticipations,
                fixtureRequest.secondaryParticipation,
              )
            : undefined,
        checkInsByArea,
        safetyByArea,
        historyByArea,
        requestedOverride:
          fixtureRequest.requestedOverride !== undefined
            ? member(routineLevels, fixtureRequest.requestedOverride)
            : undefined,
        duration: member(
          ['quick', 'standard'] as const,
          fixtureRequest.duration,
        ),
      }),
    );

    if (testCase.expected.kind === 'noPlan') {
      const outcome = noPlan(result);
      expect({
        kind: outcome.kind,
        reason: outcome.reason,
        affectedAreas: outcome.affectedAreas,
        safetyTransitions: outcome.safetyTransitions,
      }).toEqual(testCase.expected);
      return;
    }

    const plan = selected(result);
    expect({
      kind: 'selected',
      recommendedLevel: plan.recommendedLevel,
      requestedOverride: plan.requestedOverride ?? null,
      selectedLevel: plan.selectedLevel,
      overrideDisposition: plan.overrideDisposition,
      duration: plan.duration,
      includedAreaDecisions: plan.includedAreaDecisions,
      omittedAreas: plan.omittedAreas,
      compositionRequest: {
        ...plan.compositionRequest,
        secondaryArea: plan.compositionRequest.secondaryArea ?? null,
      },
      explanations: plan.explanations,
      notices: plan.notices,
      pauseTodayAvailable: plan.pauseTodayAvailable,
    }).toEqual(testCase.expected);
  });

  it('matches every single-area level across areas, answers, unlock state, and duration', () => {
    const changes: readonly ChangeReport[] = ['better', 'similar', 'worse'];
    const durations = ['quick', 'standard'] as const;

    for (const area of bodyAreas) {
      for (const changeReport of changes) {
        for (const movementComfort of movementComforts) {
          for (const activeUnlocked of [false, true]) {
            for (const duration of durations) {
              const needsSafety =
                changeReport === 'worse' || movementComfort === 'limited';
              const areaCheckIn = checkIn(area, {
                changeReport,
                movementComfort,
                conditionalSafetyAnswer: needsSafety ? 'no' : undefined,
              });
              const historyByArea = activeUnlocked
                ? { [area]: unlockedHistory(area) }
                : {};
              const plan = selected(
                selectPlan(
                  request({
                    primaryArea: area,
                    checkInsByArea: { [area]: areaCheckIn },
                    historyByArea,
                    duration,
                  }),
                ),
              );

              expect(plan.recommendedLevel).toBe(
                selectAreaLevel({
                  changeReport,
                  movementComfort,
                  activeUnlocked,
                }),
              );
              expect(plan.selectedLevel).toBe(plan.recommendedLevel);
              expect(plan.duration).toBe(duration);
            }
          }
        }
      }
    }
  });

  it('fails closed for pending and triggering conditional safety answers', () => {
    for (const answer of conditionalSafetyAnswers) {
      const result = selectPlan(
        request({
          checkInsByArea: {
            neck: checkIn('neck', {
              changeReport: 'worse',
              conditionalSafetyAnswer: answer,
            }),
          },
        }),
      );

      if (answer === 'no') {
        expect(selected(result).recommendedLevel).toBe('gentle');
      } else {
        const blocked = noPlan(result);
        expect(blocked.reason).toBe('attention_required');
        expect(blocked.affectedAreas).toEqual(['neck']);
        expect(blocked.safetyTransitions.map(({ answer: value }) => value)).toEqual([
          answer,
        ]);
      }
    }

    const pending = noPlan(
      selectPlan(
        request({
          checkInsByArea: {
            neck: checkIn('neck', { movementComfort: 'limited' }),
          },
        }),
      ),
    );
    expect(pending.reason).toBe('needs_primary_safety_answer');
  });

  it('lets persisted Attention block globally in supported-area order', () => {
    const blocked = noPlan(
      selectPlan(
        request({
          safetyByArea: {
            neck: { area: 'neck', status: 'attentionRequired' },
            upperMidBack: { area: 'upperMidBack', status: 'normal' },
            lowerBack: { area: 'lowerBack', status: 'attentionRequired' },
          },
        }),
      ),
    );

    expect(blocked.reason).toBe('attention_required');
    expect(blocked.affectedAreas).toEqual(['neck', 'lowerBack']);
    expect(blocked.safetyTransitions).toEqual([]);
  });

  it('blocks every two-area safety pair when either answer flags Attention', () => {
    for (const primaryArea of bodyAreas) {
      for (const secondaryArea of bodyAreas) {
        if (secondaryArea === primaryArea) {
          continue;
        }
        for (const duration of ['quick', 'standard'] as const) {
          for (const primaryAnswer of conditionalSafetyAnswers) {
            for (const secondaryAnswer of conditionalSafetyAnswers) {
              const result = selectPlan(
                request({
                  primaryArea,
                  secondaryArea,
                  secondaryParticipation: 'include',
                  duration,
                  requestedOverride: 'active',
                  checkInsByArea: {
                    [primaryArea]: checkIn(primaryArea, {
                      changeReport: 'worse',
                      conditionalSafetyAnswer: primaryAnswer,
                    }),
                    [secondaryArea]: checkIn(secondaryArea, {
                      role: 'secondary',
                      changeReport: 'worse',
                      conditionalSafetyAnswer: secondaryAnswer,
                    }),
                  },
                }),
              );
              const flaggedAreas = [
                primaryAnswer === 'no' ? undefined : primaryArea,
                secondaryAnswer === 'no' ? undefined : secondaryArea,
              ].filter((area): area is BodyArea => area !== undefined);

              if (flaggedAreas.length === 0) {
                const plan = selected(result);
                expect(plan.recommendedLevel).toBe('gentle');
                expect(plan.overrideDisposition).toBe('rejectedHigher');
              } else {
                const blocked = noPlan(result);
                expect(blocked.reason).toBe('attention_required');
                expect(blocked.affectedAreas).toEqual(flaggedAreas);
                expect(blocked.safetyTransitions.map(({ area }) => area)).toEqual(
                  flaggedAreas,
                );
              }
            }
          }
        }
      }
    }
  });

  it('returns exact missing-check-in continuation states', () => {
    expect(
      noPlan(selectPlan(request({ checkInsByArea: {} }))).reason,
    ).toBe('needs_primary_check_in');

    expect(
      noPlan(
        selectPlan(
          request({
            secondaryArea: 'upperMidBack',
            secondaryParticipation: 'include',
          }),
        ),
      ).reason,
    ).toBe('needs_secondary_check_in');
  });

  it('makes secondary skipping explicit but never bypasses a trigger', () => {
    const skipped = selected(
      selectPlan(
        request({
          secondaryArea: 'upperMidBack',
          secondaryParticipation: 'skipForSession',
        }),
      ),
    );
    expect(skipped.includedAreaDecisions.map(({ area }) => area)).toEqual([
      'neck',
    ]);
    expect(skipped.omittedAreas).toEqual([
      { area: 'upperMidBack', reason: 'secondaryUnanswered' },
    ]);
    expect(skipped.notices).toEqual([
      { key: 'notice.secondary_skipped', area: 'upperMidBack' },
    ]);

    const pending = noPlan(
      selectPlan(
        request({
          secondaryArea: 'upperMidBack',
          secondaryParticipation: 'skipForSession',
          checkInsByArea: {
            neck: checkIn('neck'),
            upperMidBack: checkIn('upperMidBack', {
              role: 'secondary',
              changeReport: 'worse',
            }),
          },
        }),
      ),
    );
    expect(pending.reason).toBe('needs_secondary_safety_answer');

    const answeredTrigger = selected(
      selectPlan(
        request({
          secondaryArea: 'upperMidBack',
          secondaryParticipation: 'skipForSession',
          checkInsByArea: {
            neck: checkIn('neck'),
            upperMidBack: checkIn('upperMidBack', {
              role: 'secondary',
              changeReport: 'worse',
              conditionalSafetyAnswer: 'no',
            }),
          },
        }),
      ),
    );
    expect(answeredTrigger.pauseTodayAvailable).toBe(true);
    expect(answeredTrigger.compositionRequest.secondaryArea).toBeUndefined();
  });

  it('reduces every two-area level pair to the gentler level', () => {
    for (const primaryArea of bodyAreas) {
      for (const secondaryArea of bodyAreas) {
        if (secondaryArea === primaryArea) {
          continue;
        }
        for (const duration of ['quick', 'standard'] as const) {
          for (const primaryLevel of routineLevels) {
            for (const secondaryLevel of routineLevels) {
              const primary = inputForLevel(primaryLevel);
              const secondary = inputForLevel(secondaryLevel);
              const plan = selected(
                selectPlan(
                  request({
                    primaryArea,
                    secondaryArea,
                    secondaryParticipation: 'include',
                    duration,
                    checkInsByArea: {
                      [primaryArea]: checkIn(primaryArea, primary),
                      [secondaryArea]: checkIn(secondaryArea, {
                        ...secondary,
                        role: 'secondary',
                      }),
                    },
                    historyByArea: {
                      ...(primary.unlocked
                        ? { [primaryArea]: unlockedHistory(primaryArea) }
                        : {}),
                      ...(secondary.unlocked
                        ? { [secondaryArea]: unlockedHistory(secondaryArea) }
                        : {}),
                    },
                  }),
                ),
              );
              const expected =
                routineLevelRanks[primaryLevel] <
                routineLevelRanks[secondaryLevel]
                  ? primaryLevel
                  : secondaryLevel;
              expect(plan.recommendedLevel).toBe(expected);
              expect(plan.compositionRequest.secondaryArea).toBe(secondaryArea);
            }
          }
        }
      }
    }
  });

  it('accepts only gentler overrides', () => {
    for (const recommended of routineLevels) {
      const input = inputForLevel(recommended);
      for (const requestedOverride of routineLevels) {
        const plan = selected(
          selectPlan(
            request({
              checkInsByArea: { neck: checkIn('neck', input) },
              historyByArea: input.unlocked
                ? { neck: unlockedHistory('neck') }
                : {},
              requestedOverride,
            }),
          ),
        );
        const recommendedRank = routineLevelRanks[recommended];
        const requestedRank = routineLevelRanks[requestedOverride];
        expect(plan.selectedLevel).toBe(
          requestedRank < recommendedRank ? requestedOverride : recommended,
        );
        expect(plan.overrideDisposition).toBe(
          requestedRank < recommendedRank
            ? 'acceptedGentler'
            : requestedRank === recommendedRank
              ? 'sameAsRecommended'
              : 'rejectedHigher',
        );
      }
    }
  });

  it('rejects malformed structural input', () => {
    const base = request();
    const malformed: readonly PlanSelectionRequest[] = [
      { ...base, rulesVersion: 'future-rules' },
      { ...base, decisionRevision: 0 },
      { ...base, decisionRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, catalogVersion: '   ' },
      {
        ...base,
        secondaryArea: 'upperMidBack',
      },
      {
        ...base,
        secondaryParticipation: 'include',
      },
      {
        ...base,
        secondaryArea: 'neck',
        secondaryParticipation: 'include',
      },
      {
        ...base,
        checkInsByArea: {
          neck: checkIn('neck', { conditionalSafetyAnswer: 'yes' }),
        },
      },
      {
        ...base,
        safetyByArea: {
          neck: { area: 'neck', status: 'normal' },
          upperMidBack: { area: 'upperMidBack', status: 'normal' },
        },
      },
      {
        ...base,
        safetyByArea: {
          ...normalSafety(),
          neck: { area: 'lowerBack', status: 'normal' },
        },
      },
      {
        ...base,
        checkInsByArea: { neck: checkIn('lowerBack') },
      },
      {
        ...base,
        checkInsByArea: { neck: undefined },
      },
      {
        ...base,
        historyByArea: { neck: unlockedHistory('lowerBack') },
      },
      {
        ...base,
        historyByArea: {
          neck: {
            ...unlockedHistory('neck'),
            mostRecentRecordedResponse: 'unknown',
          } as unknown as ActiveHistoryState,
        },
      },
      {
        ...base,
        secondaryArea: 'upperMidBack',
        secondaryParticipation: 'include',
        checkInsByArea: {
          neck: checkIn('neck'),
          upperMidBack: {
            ...checkIn('upperMidBack', { role: 'secondary' }),
            checkInEntryId: entryId('primary'),
          },
        },
      },
    ];

    for (const candidate of malformed) {
      const rejected = noPlan(selectPlan(candidate));
      expect(rejected.reason).toBe('invalid_input');
      expect(rejected.affectedAreas).toEqual([]);
      expect(rejected.safetyTransitions).toEqual([]);
    }
  });

  it('keeps explanations stable, bounded, and immutable', () => {
    const plan = selected(
      selectPlan(
        request({
          secondaryArea: 'upperMidBack',
          secondaryParticipation: 'include',
          requestedOverride: 'gentle',
          checkInsByArea: {
            neck: checkIn('neck', {
              changeReport: 'better',
              movementComfort: 'good',
            }),
            upperMidBack: checkIn('upperMidBack', {
              role: 'secondary',
              changeReport: 'similar',
              movementComfort: 'good',
            }),
          },
          historyByArea: { neck: unlockedHistory('neck') },
        }),
      ),
    );

    expect(plan.explanations.map(({ key }) => key)).toEqual([
      'reason.user_gentler_override',
      'reason.balanced_checkin',
    ]);
    expect(plan.explanations).toHaveLength(2);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.explanations)).toBe(true);
    expect(Object.isFrozen(plan.explanations[0]?.parameters)).toBe(true);
  });

  it('emits the exact check-in explanation keys', () => {
    const cases: readonly Readonly<{
      changeReport: ChangeReport;
      movementComfort: MovementComfort;
      conditionalSafetyAnswer?: ConditionalSafetyAnswer;
      unlocked: boolean;
      expectedKey:
        | 'reason.reported_worse'
        | 'reason.movement_limited'
        | 'reason.better_good_active'
        | 'reason.balanced_checkin'
        | 'reason.active_locked';
    }>[] = [
      {
        changeReport: 'worse',
        movementComfort: 'limited',
        conditionalSafetyAnswer: 'no',
        unlocked: false,
        expectedKey: 'reason.reported_worse',
      },
      {
        changeReport: 'similar',
        movementComfort: 'limited',
        conditionalSafetyAnswer: 'no',
        unlocked: false,
        expectedKey: 'reason.movement_limited',
      },
      {
        changeReport: 'better',
        movementComfort: 'good',
        unlocked: true,
        expectedKey: 'reason.better_good_active',
      },
      {
        changeReport: 'similar',
        movementComfort: 'good',
        unlocked: false,
        expectedKey: 'reason.balanced_checkin',
      },
      {
        changeReport: 'better',
        movementComfort: 'good',
        unlocked: false,
        expectedKey: 'reason.active_locked',
      },
    ];

    for (const testCase of cases) {
      const plan = selected(
        selectPlan(
          request({
            checkInsByArea: { neck: checkIn('neck', testCase) },
            historyByArea: testCase.unlocked
              ? { neck: unlockedHistory('neck') }
              : {},
          }),
        ),
      );
      expect(plan.explanations[0]?.key).toBe(testCase.expectedKey);
    }

    const activeLocked = selected(
      selectPlan(
        request({
          checkInsByArea: {
            neck: checkIn('neck', {
              changeReport: 'better',
              movementComfort: 'good',
            }),
          },
        }),
      ),
    );
    expect(activeLocked.explanations[0]?.parameters).toEqual({
      area: 'neck',
      threshold: String(
        prototypeActiveUnlockConfiguration.qualifyingOutcomeCountRequired,
      ),
    });
  });

  it('anchors ties to primary and explains a more-conservative secondary', () => {
    const limitingSecondary = selected(
      selectPlan(
        request({
          secondaryArea: 'upperMidBack',
          secondaryParticipation: 'include',
          checkInsByArea: {
            neck: checkIn('neck'),
            upperMidBack: checkIn('upperMidBack', {
              role: 'secondary',
              changeReport: 'worse',
              conditionalSafetyAnswer: 'no',
            }),
          },
        }),
      ),
    );
    expect(limitingSecondary.explanations).toEqual([
      { key: 'reason.reported_worse', parameters: { area: 'upperMidBack' } },
      {
        key: 'reason.secondary_more_conservative',
        parameters: { area: 'upperMidBack' },
      },
    ]);

    const tied = selected(
      selectPlan(
        request({
          secondaryArea: 'upperMidBack',
          secondaryParticipation: 'include',
          checkInsByArea: {
            neck: checkIn('neck', {
              changeReport: 'worse',
              conditionalSafetyAnswer: 'no',
            }),
            upperMidBack: checkIn('upperMidBack', {
              role: 'secondary',
              movementComfort: 'limited',
              conditionalSafetyAnswer: 'no',
            }),
          },
        }),
      ),
    );
    expect(tied.explanations).toEqual([
      { key: 'reason.reported_worse', parameters: { area: 'neck' } },
    ]);
  });

  it('orders configured and nonconfigured Attention deterministically', () => {
    const blocked = noPlan(
      selectPlan(
        request({
          primaryArea: 'lowerBack',
          secondaryArea: 'neck',
          secondaryParticipation: 'include',
          checkInsByArea: {
            lowerBack: checkIn('lowerBack'),
            neck: checkIn('neck', { role: 'secondary' }),
          },
          safetyByArea: {
            neck: { area: 'neck', status: 'attentionRequired' },
            upperMidBack: {
              area: 'upperMidBack',
              status: 'attentionRequired',
            },
            lowerBack: { area: 'lowerBack', status: 'attentionRequired' },
          },
        }),
      ),
    );
    expect(blocked.affectedAreas).toEqual([
      'lowerBack',
      'neck',
      'upperMidBack',
    ]);
  });

  it('is invariant to excluded context and duration outside duration fields', () => {
    const contexts = [
      {
        healthValue: undefined,
        telemetryEnabled: false,
        reminderEnabled: false,
        connected: false,
        availableMinutes: 1,
        occupation: 'desk',
        age: 18,
        weeklyGoal: 1,
        clockTime: '00:00:00Z',
        consistencyDays: 0,
      },
      {
        healthValue: 100,
        telemetryEnabled: true,
        reminderEnabled: true,
        connected: true,
        availableMinutes: 90,
        occupation: 'manual',
        age: 100,
        weeklyGoal: 7,
        clockTime: '23:59:59Z',
        consistencyDays: 365,
      },
    ] as const;
    const base = request({
      checkInsByArea: {
        neck: checkIn('neck', {
          changeReport: 'better',
          movementComfort: 'good',
        }),
      },
      historyByArea: { neck: unlockedHistory('neck') },
    });
    const quick = selected(selectPlan({ ...base, duration: 'quick' }));
    const standard = selected(selectPlan({ ...base, duration: 'standard' }));
    const decisionOnly = (plan: typeof quick) => ({
      recommendedLevel: plan.recommendedLevel,
      selectedLevel: plan.selectedLevel,
      includedAreaDecisions: plan.includedAreaDecisions,
      explanations: plan.explanations,
      pauseTodayAvailable: plan.pauseTodayAvailable,
    });
    expect(decisionOnly(quick)).toEqual(decisionOnly(standard));

    const expected = selectPlan(base);
    for (const context of contexts) {
      expect(selectPlan({ ...base, ...context })).toEqual(expected);
    }
  });
});
