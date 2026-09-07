import { describe, expect, it } from '@jest/globals';

import { bodyAreas, parseCheckInEntryId, parseCheckInId, parseSelectionDecisionId } from '../domain/selection-domain';
import { createCheckIn, parseLocalDay } from '../persistence/persistence-domain';
import type { RoutineAreaOutcome } from '../selection/active-history';
import type { Result } from '../shared/result';
import { buildAuthoritativePlan, type AuthoritativePlanInput } from './authoritative-plan';

const createdAtMilliseconds = 1_783_000_000_000;
const firstRevision = 1;
const canonicalQuickItemCount = 5;
const canonicalQuickNominalSeconds = 300;
const canonicalQuickMovementSeconds = [60, 120, 90];
const qualifyingOutcome: RoutineAreaOutcome = {
  area: 'neck',
  routineStatus: 'completed',
  deliveredLevel: 'balanced',
  response: 'same',
  wasIncludedInDeliveredRoutine: true,
};
const unlockedHistory = [qualifyingOutcome, qualifyingOutcome];
const activeUnlockQualifyingCount = 2;

function required<Value, Failure>(result: Result<Value, Failure>): Value {
  if (!result.ok) throw new Error(`Fixture failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function input(overrides: Partial<AuthoritativePlanInput> = {}): AuthoritativePlanInput {
  return {
    checkIn: required(createCheckIn({
      id: required(parseCheckInId('11111111-1111-4111-8111-111111111111')),
      kind: 'normal',
      status: 'completed',
      primaryArea: 'neck',
      startedAtMilliseconds: createdAtMilliseconds,
      completedAtMilliseconds: createdAtMilliseconds,
      dayContext: {
        localDay: required(parseLocalDay('2026-07-01')),
        timeZoneId: 'UTC',
        calendarId: 'gregorian',
      },
      entries: [{
        id: required(parseCheckInEntryId('22222222-2222-4222-8222-222222222222')),
        area: 'neck',
        role: 'primary',
        changeReport: 'better',
        movementComfort: 'good',
        submittedAtMilliseconds: createdAtMilliseconds,
      }],
    })),
    decisionId: required(parseSelectionDecisionId('33333333-3333-4333-8333-333333333333')),
    revision: firstRevision,
    duration: 'quick',
    attentionRequiredAreas: [],
    orderedOutcomes: [],
    createdAtMilliseconds,
    ...overrides,
  };
}

describe('Authoritative plan', () => {
  it('includes the answered secondary area using the authored replacement and conservative level', () => {
    const request = input({ secondaryArea: 'lowerBack' });
    const checkIn = required(createCheckIn({
      ...request.checkIn,
      secondaryArea: 'lowerBack',
      entries: [
        ...request.checkIn.entries,
        {
          id: required(parseCheckInEntryId('44444444-4444-4444-8444-444444444444')),
          area: 'lowerBack',
          role: 'secondary',
          changeReport: 'similar',
          movementComfort: 'limited',
          conditionalSafetyAnswer: 'no',
          submittedAtMilliseconds: createdAtMilliseconds,
        },
      ],
    }));
    const result = required(buildAuthoritativePlan({ ...request, checkIn }));
    expect(result).toMatchObject({
      kind: 'approved',
      recommendedLevel: 'gentle',
      deliveredLevel: 'gentle',
      composition: { includedAreas: ['neck', 'lowerBack'], nominalSeconds: canonicalQuickNominalSeconds },
      decision: { secondaryModuleId: 'kineo.secondary.lower-back.gentle.quick.v1' },
    });
    if (result.kind !== 'approved') return;
    expect(result.snapshotTemplate.items.filter((item) => item.sourceArea === 'lowerBack')).toMatchObject([
      {
        kind: 'movement',
        movementId: 'kineo.prototype.movement.lower-back.base.5.v1',
        scheduledDose: { kind: 'timed', activeSeconds: canonicalQuickMovementSeconds[1] },
      },
    ]);
  });

  it('rejects an incomplete check-in instead of issuing an approved plan', () => {
    const request = input();
    expect(buildAuthoritativePlan({
      ...request,
      checkIn: { ...request.checkIn, status: 'draft', completedAtMilliseconds: undefined },
    })).toEqual({ ok: false, error: { code: 'invalidInput' } });
  });

  it('records a profile secondary area skipped for this session without delivering its content', () => {
    const result = required(buildAuthoritativePlan(input({ secondaryArea: 'lowerBack' })));
    expect(result).toMatchObject({
      kind: 'approved',
      selectedPlan: { omittedAreas: [{ area: 'lowerBack', reason: 'secondaryUnanswered' }] },
      decision: {
        secondaryOmissionReason: 'secondaryUnanswered',
        notices: [{ code: 'notice.secondary_skipped', area: 'lowerBack' }],
      },
      composition: { includedAreas: ['neck'] },
      snapshotTemplate: { includedAreas: ['neck'], notices: ['notice.secondary_skipped'] },
    });
    if (result.kind !== 'approved') return;
    expect(result.decision.secondaryModuleId).toBeUndefined();
    expect(result.snapshotTemplate.items.every((item) => item.sourceArea === 'neck')).toBe(true);
  });

  it('preserves the active recommendation while applying a gentler requested override', () => {
    const result = required(buildAuthoritativePlan(input({
      orderedOutcomes: unlockedHistory,
      requestedOverride: 'gentle',
    })));
    expect(result).toMatchObject({
      kind: 'approved',
      recommendedLevel: 'active',
      selectedLevel: 'gentle',
      deliveredLevel: 'gentle',
      decision: {
        requestedOverride: 'gentle',
        overrideDisposition: 'acceptedGentler',
        primaryTemplateId: 'kineo.primary.neck.gentle.quick.v1',
      },
      snapshotTemplate: {
        selectedLevel: 'gentle',
        deliveredLevel: 'gentle',
        presentedExplanationKeys: ['reason.user_gentler_override', 'reason.better_good_active'],
      },
    });
  });

  it('unlocks active from qualifying history and resets it after a later worse outcome', () => {
    const unlocked = required(buildAuthoritativePlan(input({ orderedOutcomes: unlockedHistory })));
    expect(unlocked).toMatchObject({
      kind: 'approved',
      recommendedLevel: 'active',
      decision: { areaInputs: [{ activeUnlocked: true, qualifyingCount: activeUnlockQualifyingCount }] },
    });

    const reset = required(buildAuthoritativePlan(input({
      orderedOutcomes: [
        ...unlockedHistory,
        { ...qualifyingOutcome, routineStatus: 'stopped', response: 'worse' },
      ],
    })));
    expect(reset).toMatchObject({
      kind: 'approved',
      recommendedLevel: 'balanced',
      decision: { areaInputs: [{ activeUnlocked: false, qualifyingCount: 0, latestResponse: 'worse' }] },
    });
  });

  it.each(bodyAreas)('suppresses every plan when %s requires attention, even if unselected', (area) => {
    expect(buildAuthoritativePlan(input({ attentionRequiredAreas: [area] }))).toEqual({
      ok: true,
      value: {
        kind: 'noPlan',
        reason: 'attention_required',
        affectedAreas: [area],
        safetyTransitions: [],
      },
    });
  });

  it('returns canonical authored items, doses, explanations and decision metadata', () => {
    const result = required(buildAuthoritativePlan(input()));
    expect(result.kind).toBe('approved');
    if (result.kind !== 'approved') return;

    expect(result).toMatchObject({
      decisionRevision: firstRevision,
      rulesVersion: 'selection-v1.0.0-prototype',
      catalogVersion: '0.1.0',
      recommendedLevel: 'balanced',
      selectedLevel: 'balanced',
      deliveredLevel: 'balanced',
      duration: 'quick',
      decision: {
        outcome: 'selected',
        validationResult: 'exact',
        primaryTemplateId: 'kineo.primary.neck.balanced.quick.v1',
        areaInputs: [{ area: 'neck', qualifyingCount: 0, activeUnlocked: false, included: true }],
        reasons: [{ kind: 'selection', position: 0, code: 'reason.active_locked' }],
      },
      snapshotTemplate: {
        sessionId: '33333333-3333-4333-8333-333333333333',
        compositionId: '33333333-3333-4333-8333-333333333333',
        includedAreas: ['neck'],
        createdAtMilliseconds,
        presentedExplanationKeys: ['reason.active_locked'],
      },
    });
    expect(result.composition.nominalSeconds).toBe(canonicalQuickNominalSeconds);
    expect(result.snapshotTemplate.items).toHaveLength(canonicalQuickItemCount);
    expect(result.snapshotTemplate.items.filter((item) => item.kind === 'movement').map(
      (item) => item.scheduledDose.estimatedSeconds,
    )).toEqual(canonicalQuickMovementSeconds);
    expect(result.snapshotTemplate.items.filter((item) => item.kind === 'movement').map(
      (item) => item.movementId,
    )).toEqual([
      'kineo.prototype.movement.neck.base.1.v1',
      'kineo.prototype.movement.neck.base.4.v1',
      'kineo.prototype.movement.neck.base.2.v1',
    ]);
    expect(result.snapshotTemplate.fingerprint).toBe(result.decision.compositionFingerprint);
  });
});
