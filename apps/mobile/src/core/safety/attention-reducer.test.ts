import { describe, expect, it } from '@jest/globals';

import parityFixture from '../../../../../Packages/KineoModules/Tests/KineoCoreTests/Fixtures/attention-reducer-v1.json';
import {
  bodyAreas,
  changeReports,
  conditionalSafetyAnswers,
  movementComforts,
  parseCheckInId,
  parseCheckInEntryId,
  safetyStatuses,
  type BodyArea,
  type ChangeReport,
  type ConditionalSafetyAnswer,
  type MovementComfort,
  type SafetyStatus,
  type SelectionAreaCheckIn,
} from '../domain/selection-domain';
import {
  attentionReductionErrors,
  attentionReturnAnswers,
  correctionDirectiveKinds,
  reduceAttentionCorrection,
  reduceAttentionReturn,
  returnDirectiveKinds,
  type AttentionReductionError,
  type AttentionCorrectionContext,
  type AttentionReturnAnswer,
} from './attention-reducer';

const correctionCheckInIdValue = '00000000-0000-0000-0000-000000000101';

function requireMember<const Values extends readonly string[]>(
  values: Values,
  candidate: string,
): Values[number] {
  if (!values.includes(candidate as Values[number])) {
    throw new Error(`Invalid parity fixture value: ${candidate}`);
  }
  return candidate as Values[number];
}

function parseEntry(
  candidate: (typeof parityFixture.correctionCases)[number]['entry'],
): SelectionAreaCheckIn {
  const idResult = parseCheckInEntryId(candidate.checkInEntryID);
  if (!idResult.ok) {
    throw new Error(`Invalid parity fixture ID: ${candidate.checkInEntryID}`);
  }

  return {
    checkInEntryId: idResult.value,
    entryRevision: candidate.entryRevision,
    area: requireMember(bodyAreas, candidate.area) as BodyArea,
    changeReport: requireMember(
      changeReports,
      candidate.changeReport,
    ) as ChangeReport,
    movementComfort: requireMember(
      movementComforts,
      candidate.movementComfort,
    ) as MovementComfort,
    conditionalSafetyAnswer:
      candidate.conditionalSafetyAnswer === undefined
        ? undefined
        : (requireMember(
            conditionalSafetyAnswers,
            candidate.conditionalSafetyAnswer,
          ) as ConditionalSafetyAnswer),
  };
}

function correctionContextFor(
  entry: SelectionAreaCheckIn,
  sourceArea: BodyArea,
): AttentionCorrectionContext {
  const checkInIdResult = parseCheckInId(correctionCheckInIdValue);
  if (!checkInIdResult.ok) {
    throw new Error('The test correction check-in ID is invalid.');
  }

  return {
    checkInId: checkInIdResult.value,
    kind: 'attentionCorrection',
    sourceArea,
    submittedEntryIds: [entry.checkInEntryId],
  };
}

describe('Attention reducer parity', () => {
  it('covers every directive, return answer, and typed error', () => {
    const fixtureReturnDirectives = parityFixture.returnCases.flatMap(
      ({ expectedDirective }) =>
        expectedDirective === undefined ? [] : [expectedDirective],
    );
    const fixtureCorrectionDirectives = parityFixture.correctionCases.flatMap(
      ({ expectedDirective }) =>
        expectedDirective === undefined ? [] : [expectedDirective],
    );
    const fixtureErrors = [
      ...parityFixture.returnCases,
      ...parityFixture.correctionCases,
    ].flatMap(({ expectedError }) =>
      expectedError === undefined ? [] : [expectedError],
    );

    expect(new Set(fixtureReturnDirectives)).toEqual(
      new Set(returnDirectiveKinds),
    );
    expect(new Set(fixtureCorrectionDirectives)).toEqual(
      new Set(correctionDirectiveKinds),
    );
    expect(new Set(fixtureErrors)).toEqual(new Set(attentionReductionErrors));
    expect(
      new Set(parityFixture.returnCases.map(({ answer }) => answer)),
    ).toEqual(new Set(attentionReturnAnswers));
  });

  it.each(parityFixture.returnCases)('$name', (testCase) => {
    const result = reduceAttentionReturn({
      area: requireMember(bodyAreas, testCase.area) as BodyArea,
      currentStatus: requireMember(
        safetyStatuses,
        testCase.currentStatus,
      ) as SafetyStatus,
      answer: requireMember(
        attentionReturnAnswers,
        testCase.answer,
      ) as AttentionReturnAnswer,
    });

    if (testCase.expectedError !== undefined) {
      expect(result).toEqual({
        ok: false,
        error: requireMember(
          attentionReductionErrors,
          testCase.expectedError,
        ) as AttentionReductionError,
      });
      return;
    }

    expect(result).toEqual({
      ok: true,
      value: {
        kind: requireMember(
          returnDirectiveKinds,
          testCase.expectedDirective,
        ),
        area: testCase.area,
      },
    });
  });

  it.each(parityFixture.correctionCases)('$name', (testCase) => {
    const entry = parseEntry(testCase.entry);
    const result = reduceAttentionCorrection({
      area: requireMember(bodyAreas, testCase.area) as BodyArea,
      currentStatus: requireMember(
        safetyStatuses,
        testCase.currentStatus,
      ) as SafetyStatus,
      correctionContext: correctionContextFor(
        entry,
        requireMember(bodyAreas, testCase.area) as BodyArea,
      ),
      correctedEntry: entry,
    });

    if (testCase.expectedError !== undefined) {
      expect(result).toEqual({
        ok: false,
        error: requireMember(
          attentionReductionErrors,
          testCase.expectedError,
        ) as AttentionReductionError,
      });
      return;
    }

    const expectedKind = requireMember(
      correctionDirectiveKinds,
      testCase.expectedDirective,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.kind).toBe(expectedKind);
    expect(result.value.area).toBe(testCase.area);
    expect(result.value.sourceEntryId).toBe(entry.checkInEntryId);
    if (result.value.kind === 'reaffirmAttention') {
      expect(result.value.answer).toBe(entry.conditionalSafetyAnswer);
    }
  });

  it('rejects a fractional entry revision explicitly', () => {
    const fractionalEntryRevision = 1.5;
    const idResult = parseCheckInEntryId(
      '00000000-0000-0000-0000-000000000014',
    );
    expect(idResult.ok).toBe(true);
    if (!idResult.ok) {
      return;
    }

    expect(
      reduceAttentionCorrection({
        area: 'neck',
        currentStatus: 'attentionRequired',
        correctionContext: correctionContextFor(
          {
            checkInEntryId: idResult.value,
            entryRevision: fractionalEntryRevision,
            area: 'neck',
            changeReport: 'similar',
            movementComfort: 'good',
          },
          'neck',
        ),
        correctedEntry: {
          checkInEntryId: idResult.value,
          entryRevision: fractionalEntryRevision,
          area: 'neck',
          changeReport: 'similar',
          movementComfort: 'good',
        },
      }),
    ).toEqual({ ok: false, error: 'invalidEntryRevision' });
  });

  it('rejects revisions outside JavaScript safe integer precision', () => {
    const unsafeEntryRevision = Number.MAX_SAFE_INTEGER + 1;
    const idResult = parseCheckInEntryId(
      '00000000-0000-0000-0000-000000000015',
    );
    expect(idResult.ok).toBe(true);
    if (!idResult.ok) {
      return;
    }
    const entry: SelectionAreaCheckIn = {
      checkInEntryId: idResult.value,
      entryRevision: unsafeEntryRevision,
      area: 'neck',
      changeReport: 'similar',
      movementComfort: 'good',
    };

    expect(
      reduceAttentionCorrection({
        area: 'neck',
        currentStatus: 'attentionRequired',
        correctionContext: correctionContextFor(entry, 'neck'),
        correctedEntry: entry,
      }),
    ).toEqual({ ok: false, error: 'invalidEntryRevision' });
  });

  it('rejects correction entries without fresh-draft provenance', () => {
    const idResult = parseCheckInEntryId(
      '00000000-0000-0000-0000-000000000016',
    );
    expect(idResult.ok).toBe(true);
    if (!idResult.ok) {
      return;
    }
    const entry: SelectionAreaCheckIn = {
      checkInEntryId: idResult.value,
      entryRevision: 1,
      area: 'neck',
      changeReport: 'similar',
      movementComfort: 'good',
    };
    const validContext = correctionContextFor(entry, 'neck');

    expect(
      reduceAttentionCorrection({
        area: 'neck',
        currentStatus: 'attentionRequired',
        correctionContext: { ...validContext, sourceArea: 'lowerBack' },
        correctedEntry: entry,
      }),
    ).toEqual({ ok: false, error: 'invalidCorrectionProvenance' });
    expect(
      reduceAttentionCorrection({
        area: 'neck',
        currentStatus: 'attentionRequired',
        correctionContext: { ...validContext, submittedEntryIds: [] },
        correctedEntry: entry,
      }),
    ).toEqual({ ok: false, error: 'invalidCorrectionProvenance' });
    expect(
      reduceAttentionCorrection({
        area: 'neck',
        currentStatus: 'attentionRequired',
        correctionContext: {
          ...validContext,
          triggeringEntryId: entry.checkInEntryId,
        },
        correctedEntry: entry,
      }),
    ).toEqual({ ok: false, error: 'invalidCorrectionProvenance' });
  });
});
