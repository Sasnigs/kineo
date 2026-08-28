import { describe, expect, it } from '@jest/globals';

import {
  parseCheckInId,
  parseCheckInEntryId,
  parseSelectionDecisionId,
  requiresConditionalSafetyAnswer,
  routineLevelRanks,
} from './selection-domain';

describe('selection domain boundaries', () => {
  it('accepts only lower-case canonical check-in entry IDs', () => {
    const canonicalId = '123e4567-e89b-12d3-a456-426614174000';

    expect(parseCheckInEntryId(canonicalId)).toEqual({
      ok: true,
      value: canonicalId,
    });
    expect(parseCheckInEntryId(canonicalId.toUpperCase())).toEqual({
      ok: false,
      error: 'invalidIdentifier',
    });
    expect(parseCheckInEntryId('not-a-uuid')).toEqual({
      ok: false,
      error: 'invalidIdentifier',
    });
    expect(parseCheckInEntryId(undefined)).toEqual({
      ok: false,
      error: 'invalidIdentifier',
    });
    expect(parseCheckInId(canonicalId)).toEqual({
      ok: true,
      value: canonicalId,
    });
    expect(parseSelectionDecisionId(canonicalId)).toEqual({
      ok: true,
      value: canonicalId,
    });
    expect(parseSelectionDecisionId('not-a-uuid')).toEqual({
      ok: false,
      error: 'invalidIdentifier',
    });
  });

  it('requires a conditional answer for Worse or Limited', () => {
    expect(
      requiresConditionalSafetyAnswer({
        changeReport: 'worse',
        movementComfort: 'good',
      }),
    ).toBe(true);
    expect(
      requiresConditionalSafetyAnswer({
        changeReport: 'better',
        movementComfort: 'limited',
      }),
    ).toBe(true);
    expect(
      requiresConditionalSafetyAnswer({
        changeReport: 'similar',
        movementComfort: 'okay',
      }),
    ).toBe(false);
  });

  it('uses explicit conservative level ranks', () => {
    expect(routineLevelRanks.gentle).toBeLessThan(
      routineLevelRanks.balanced,
    );
    expect(routineLevelRanks.balanced).toBeLessThan(
      routineLevelRanks.active,
    );
  });
});
