import { describe, expect, it } from '@jest/globals';

import {
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
} from '../domain/selection-domain';
import { parseCatalogVersion } from '../content/catalog-primitives';
import { createSelectionDecision } from './decision-persistence-domain';

const decisionIdValue = '00000000-0000-0000-0000-000000000010';
const checkInIdValue = '00000000-0000-0000-0000-000000000011';
const entryIdValue = '00000000-0000-0000-0000-000000000012';
const firstRevision = 1;
const createdAtMilliseconds = 1_750_000_000_000;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A decision fixture failed validation.');
  }
  return result.value;
}

describe('Persisted selection decision', () => {
  it('accepts explicit content unavailability and freezes audit inputs', () => {
    const decision = createSelectionDecision({
      id: required(parseSelectionDecisionId(decisionIdValue)),
      checkInId: required(parseCheckInId(checkInIdValue)),
      revision: firstRevision,
      rulesVersion: 'selection-v1.0.0-prototype',
      catalogVersionRequested: required(parseCatalogVersion('0.1.0')),
      outcome: 'contentUnavailable',
      recommendedLevel: 'balanced',
      overrideDisposition: 'none',
      selectedLevel: 'balanced',
      duration: 'standard',
      validationResult: 'unavailable',
      createdAtMilliseconds,
      areaInputs: [
        {
          area: 'neck',
          role: 'primary',
          checkInEntryId: required(parseCheckInEntryId(entryIdValue)),
          baseLevel: 'balanced',
          activeUnlocked: false,
          qualifyingCount: 0,
          included: true,
        },
      ],
      reasons: [
        {
          kind: 'selection',
          position: 0,
          code: 'reason.balanced_checkin',
          parameters: { area: 'neck' },
        },
      ],
      notices: [],
    });

    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(Object.isFrozen(decision.value.areaInputs)).toBe(true);
      expect(Object.isFrozen(decision.value.reasons[0]?.parameters)).toBe(true);
    }
  });

  it('rejects unavailable decisions that claim delivered content', () => {
    const base = required(
      createSelectionDecision({
        id: required(parseSelectionDecisionId(decisionIdValue)),
        checkInId: required(parseCheckInId(checkInIdValue)),
        revision: firstRevision,
        rulesVersion: 'selection-v1.0.0-prototype',
        catalogVersionRequested: required(parseCatalogVersion('0.1.0')),
        outcome: 'contentUnavailable',
        recommendedLevel: 'gentle',
        overrideDisposition: 'none',
        selectedLevel: 'gentle',
        duration: 'quick',
        validationResult: 'unavailable',
        createdAtMilliseconds,
        areaInputs: [
          {
            area: 'neck',
            role: 'primary',
            checkInEntryId: required(parseCheckInEntryId(entryIdValue)),
            baseLevel: 'gentle',
            activeUnlocked: false,
            qualifyingCount: 0,
            included: true,
          },
        ],
        reasons: [],
        notices: [],
      }),
    );

    expect(
      createSelectionDecision({
        ...base,
        catalogVersionDelivered: required(parseCatalogVersion('0.1.0')),
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDomainValue', field: 'selectionDecision' },
    });
  });
});
