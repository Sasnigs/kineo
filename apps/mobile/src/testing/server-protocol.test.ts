import { describe, expect, it } from '@jest/globals';

import { selectAreaLevel } from '../core/selection/area-level-rule';
import {
  activeUnlockOutcomeCount,
  createAuthoritativePlan,
  validateSyncRequest,
} from '../../../../supabase/functions/_shared/protocol';

const installationId = '20000000-0000-4000-8000-000000000001';
const mutationId = '30000000-0000-4000-8000-000000000001';
const checkInId = '40000000-0000-4000-8000-000000000001';
const entryId = '50000000-0000-4000-8000-000000000001';
const decisionId = '60000000-0000-4000-8000-000000000001';

describe('server sync protocol', () => {
  it('rejects client-supplied server approval fields', () => {
    expect(validateSyncRequest({
      installationId,
      mutations: [{
        mutationId, installationId, historyEpoch: 1, createdAtMilliseconds: 1,
        command: { kind: 'resetHistory', authoritativePlan: { selectedLevel: 'active' } },
      }],
    })).toBeUndefined();
  });

  it('rejects reordered and installation-mismatched mutations', () => {
    const mutation = (id: string, createdAtMilliseconds: number) => ({
      mutationId: id,
      installationId,
      historyEpoch: 1,
      createdAtMilliseconds,
      command: { kind: 'resetHistory' },
    });
    expect(validateSyncRequest({
      installationId,
      mutations: [
        mutation(mutationId, 2),
        mutation('30000000-0000-4000-8000-000000000002', 1),
      ],
    })).toBeUndefined();
    expect(validateSyncRequest({
      installationId,
      mutations: [{
        ...mutation(mutationId, 1),
        installationId: '20000000-0000-4000-8000-000000000099',
      }],
    })).toBeUndefined();
  });

  it('rejects malformed commands before they reach PostgreSQL', () => {
    expect(validateSyncRequest({
      installationId,
      mutations: [{
        mutationId,
        installationId,
        historyEpoch: 1,
        createdAtMilliseconds: 1,
        command: {
          kind: 'saveProfile',
          expectedVersion: 0,
          profile: { adultAcknowledged: true, weeklyGoalDays: 99 },
        },
      }],
    })).toBeUndefined();
  });

  it('keeps server level selection in parity with the mobile domain', () => {
    const scenarios = [
      { changeReport: 'worse' as const, movementComfort: 'good' as const, unlocked: true },
      { changeReport: 'better' as const, movementComfort: 'limited' as const, unlocked: true },
      { changeReport: 'better' as const, movementComfort: 'good' as const, unlocked: false },
      { changeReport: 'better' as const, movementComfort: 'good' as const, unlocked: true },
    ];
    for (const scenario of scenarios) {
      const plan = createAuthoritativePlan({
        kind: 'submitCheckIn',
        checkIn: {
          id: checkInId,
          primaryArea: 'neck',
          entries: [{
            id: entryId,
            area: 'neck',
            changeReport: scenario.changeReport,
            movementComfort: scenario.movementComfort,
            ...(scenario.changeReport === 'worse' ||
              scenario.movementComfort === 'limited'
              ? { conditionalSafetyAnswer: 'no' }
              : {}),
          }],
        },
        decisionId,
      }, {
        neck: scenario.unlocked ? activeUnlockOutcomeCount : 0,
      });
      expect(plan?.selectedLevel).toBe(selectAreaLevel({
        changeReport: scenario.changeReport,
        movementComfort: scenario.movementComfort,
        activeUnlocked: scenario.unlocked,
      }));
    }
  });

  it('does not create a plan when a safety answer requires attention', () => {
    expect(createAuthoritativePlan({
      kind: 'submitCheckIn',
      checkIn: {
        id: checkInId,
        primaryArea: 'neck',
        entries: [{
          id: entryId,
          area: 'neck',
          changeReport: 'worse',
          movementComfort: 'limited',
          conditionalSafetyAnswer: 'notSure',
        }],
      },
      decisionId,
    }, {})).toBeUndefined();
  });

  it('does not create a plan for an attention correction', () => {
    expect(createAuthoritativePlan({
      kind: 'submitCheckIn',
      suppressPlan: true,
      checkIn: {
        id: checkInId,
        primaryArea: 'neck',
        entries: [{
          id: entryId,
          area: 'neck',
          changeReport: 'similar',
          movementComfort: 'okay',
        }],
      },
      decisionId,
    }, {})).toBeUndefined();
  });
});
