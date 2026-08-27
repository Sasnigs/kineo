import { describe, expect, it } from '@jest/globals';

import {
  parseCheckInId,
  parseCheckInEntryId,
  requiresConditionalSafetyAnswer,
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
});
