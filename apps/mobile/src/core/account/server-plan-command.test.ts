import { describe, expect, it } from '@jest/globals';

import { prepareAuthoritativePlanCommand } from './server-plan-command';

const authorityVersion = 7;
const firstDecisionRevision = 1;
const forgedClientHistoryCount = 999;
const completedAtMilliseconds = 1_783_000_000_000;
const checkInId = '11111111-1111-4111-8111-111111111111';
const decisionId = '33333333-3333-4333-8333-333333333333';
const checkIn = {
  id: checkInId,
  kind: 'normal',
  status: 'completed',
  primaryArea: 'neck',
  startedAtMilliseconds: completedAtMilliseconds,
  completedAtMilliseconds,
  dayContext: { localDay: '2026-07-01', timeZoneId: 'UTC', calendarId: 'gregorian' },
  entries: [{
    id: '22222222-2222-4222-8222-222222222222',
    area: 'neck',
    role: 'primary',
    changeReport: 'better',
    movementComfort: 'good',
    submittedAtMilliseconds: completedAtMilliseconds,
  }],
};
const command = {
  kind: 'submitCheckIn',
  checkIn,
  decisionId,
  decisionRevision: firstDecisionRevision,
  durationVariant: 'quick',
};
const context = {
  version: authorityVersion,
  secondaryArea: null,
  attentionRequiredAreas: [],
  orderedOutcomes: [],
};
const qualifyingOutcome = {
  area: 'neck',
  routineStatus: 'completed',
  deliveredLevel: 'balanced',
  response: 'same',
  wasIncludedInDeliveredRoutine: true,
};

describe('Server plan command', () => {
  it('returns no plan for account attention in an unselected area', () => {
    expect(prepareAuthoritativePlanCommand(command, {
      ...context, attentionRequiredAreas: ['upperMidBack'],
    })).toEqual({ ok: true, value: { authorityVersion, authoritativePlan: null } });
  });

  it('uses the server secondary preference and requested gentler override', () => {
    expect(prepareAuthoritativePlanCommand({ ...command, requestedOverride: 'gentle' }, {
      ...context, secondaryArea: 'lowerBack',
    })).toMatchObject({
      ok: true,
      value: { authoritativePlan: {
        recommendedLevel: 'balanced', selectedLevel: 'gentle', deliveredLevel: 'gentle',
        includedAreas: ['neck'],
        canonicalDecision: { secondaryOmissionReason: 'secondaryUnanswered' },
        snapshotTemplate: { notices: ['notice.secondary_skipped'] },
      } },
    });
  });

  it('uses ordered server history and ignores any client history-count shortcut', () => {
    expect(prepareAuthoritativePlanCommand({ ...command, historyCounts: { neck: forgedClientHistoryCount } }, {
      ...context,
      orderedOutcomes: [
        qualifyingOutcome,
        qualifyingOutcome,
        { ...qualifyingOutcome, response: 'worse' },
      ],
    })).toMatchObject({
      ok: true,
      value: { authoritativePlan: {
        recommendedLevel: 'balanced',
        canonicalDecision: { areaInputs: [{ qualifyingCount: 0, latestResponse: 'worse' }] },
      } },
    });
  });

  it.each([
    { ...command, kind: 'saveProfile' },
    { ...command, checkIn: null },
    { ...command, checkIn: { ...checkIn, status: 'draft' } },
    { ...command, checkIn: { ...checkIn, completedAtMilliseconds: undefined } },
    { ...command, checkIn: { ...checkIn, completedAtMilliseconds: 'now' } },
    { ...command, checkIn: { ...checkIn, dayContext: null } },
    { ...command, checkIn: { ...checkIn, entries: [null] } },
    { ...command, checkIn: { ...checkIn, entries: [] } },
    { ...command, checkIn: { ...checkIn, entries: [{ ...checkIn.entries[0], changeReport: 'same' }] } },
    { ...command, decisionId: 'invalid' },
    { ...command, decisionRevision: 0 },
    { ...command, durationVariant: 'long' },
    { ...command, requestedOverride: 'intense' },
    { ...command, suppressPlan: 'true' },
  ])('rejects malformed command case %# with a typed error', (malformed) => {
    expect(prepareAuthoritativePlanCommand(malformed, context)).toEqual({
      ok: false, error: { code: 'invalidCommand' },
    });
  });

  it.each([
    { ...command, suppressPlan: true },
    {
      ...command,
      checkIn: { ...checkIn, kind: 'attentionCorrection', correctionSource: { area: 'neck' } },
    },
  ])('preserves check-in-only suppression without returning plan content, case %#', (suppressed) => {
    expect(prepareAuthoritativePlanCommand(suppressed, context)).toEqual({
      ok: true, value: { authorityVersion, authoritativePlan: null },
    });
    expect(prepareAuthoritativePlanCommand(suppressed, {})).toEqual({
      ok: false, error: { code: 'invalidServerContext' },
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { ...context, version: 0 },
    { ...context, version: '7' },
    { ...context, version: Number.MAX_SAFE_INTEGER + firstDecisionRevision },
    { ...context, secondaryArea: undefined },
    { ...context, secondaryArea: 'shoulder' },
    { ...context, attentionRequiredAreas: undefined },
    { ...context, attentionRequiredAreas: ['shoulder'] },
    { ...context, attentionRequiredAreas: ['neck', 'neck'] },
    { ...context, orderedOutcomes: undefined },
    { ...context, orderedOutcomes: [null] },
    { ...context, orderedOutcomes: [{ ...qualifyingOutcome, area: 'shoulder' }] },
    { ...context, orderedOutcomes: [{ ...qualifyingOutcome, deliveredLevel: 'intense' }] },
    { ...context, orderedOutcomes: [{ ...qualifyingOutcome, routineStatus: 'inProgress' }] },
    { ...context, orderedOutcomes: [{ ...qualifyingOutcome, wasIncludedInDeliveredRoutine: false }] },
    { ...context, orderedOutcomes: [{ ...qualifyingOutcome, response: 'similar' }] },
    { ...context, orderedOutcomes: [{ ...qualifyingOutcome, response: null }] },
  ])('rejects malformed server context without defaulting missing state, case %#', (malformed) => {
    expect(prepareAuthoritativePlanCommand(command, malformed)).toEqual({
      ok: false, error: { code: 'invalidServerContext' },
    });
  });

  it('prepares SQL authority metadata with canonical content and the committed check-in timestamp', () => {
    expect(prepareAuthoritativePlanCommand(command, context)).toMatchObject({
      ok: true,
      value: {
        authorityVersion,
        authoritativePlan: {
          decisionId,
          checkInId,
          revision: firstDecisionRevision,
          rulesVersion: 'selection-v1.0.0-prototype',
          catalogVersion: '0.1.0',
          recommendedLevel: 'balanced',
          selectedLevel: 'balanced',
          deliveredLevel: 'balanced',
          durationVariant: 'quick',
          includedAreas: ['neck'],
          canonicalDecision: { id: decisionId, checkInId, createdAtMilliseconds: completedAtMilliseconds },
          snapshotTemplate: {
            decisionId,
            createdAtMilliseconds: completedAtMilliseconds,
            presentedExplanationKeys: ['reason.active_locked'],
          },
        },
      },
    });
  });
});
