import {
  requiresConditionalSafetyAnswer,
  type BodyArea,
  type CheckInEntryId,
  type CheckInId,
  type ConditionalSafetyAnswer,
  type SafetyStatus,
  type SelectionAreaCheckIn,
} from '../domain/selection-domain';
import type { Result } from '../shared/result';

export const attentionReturnAnswers = [
  'returnedToUsual',
  'notReturned',
  'notSure',
  'selectedByMistake',
] as const;
export type AttentionReturnAnswer = (typeof attentionReturnAnswers)[number];

export const returnDirectiveKinds = [
  'clearAndRequireFreshCheckIn',
  'keepAndShowGuidance',
  'keepAndStartFreshCorrection',
] as const;

export type AttentionReturnDirective = Readonly<
  | { kind: 'clearAndRequireFreshCheckIn'; area: BodyArea }
  | { kind: 'keepAndShowGuidance'; area: BodyArea }
  | { kind: 'keepAndStartFreshCorrection'; area: BodyArea }
>;

export const correctionDirectiveKinds = [
  'clearAttention',
  'reaffirmAttention',
] as const;

export type AttentionCorrectionDirective = Readonly<
  | {
      kind: 'clearAttention';
      area: BodyArea;
      sourceEntryId: SelectionAreaCheckIn['checkInEntryId'];
    }
  | {
      kind: 'reaffirmAttention';
      area: BodyArea;
      sourceEntryId: SelectionAreaCheckIn['checkInEntryId'];
      answer: Exclude<ConditionalSafetyAnswer, 'no'>;
    }
>;

export const attentionReductionErrors = [
  'attentionNotRequired',
  'areaMismatch',
  'invalidEntryRevision',
  'missingConditionalAnswer',
  'unexpectedConditionalAnswer',
] as const;
export type AttentionReductionError =
  (typeof attentionReductionErrors)[number];

export type AttentionReturnInput = Readonly<{
  area: BodyArea;
  currentStatus: SafetyStatus;
  answer: AttentionReturnAnswer;
}>;

export type AttentionCorrectionInput = Readonly<{
  area: BodyArea;
  currentStatus: SafetyStatus;
  correctionContext: AttentionCorrectionContext;
  correctedEntry: SelectionAreaCheckIn;
}>;

export type AttentionCorrectionContext = Readonly<{
  checkInId: CheckInId;
  kind: 'attentionCorrection';
  sourceArea: BodyArea;
  submittedEntryIds: readonly CheckInEntryId[];
  triggeringEntryId?: CheckInEntryId;
}>;

export type CorrectionProvenanceError = 'invalidCorrectionProvenance';

const firstEntryRevision = 1;

function failure(
  error: AttentionReductionError,
): Result<never, AttentionReductionError> {
  return { ok: false, error };
}

export function reduceAttentionReturn({
  area,
  currentStatus,
  answer,
}: AttentionReturnInput): Result<
  AttentionReturnDirective,
  AttentionReductionError
> {
  if (currentStatus !== 'attentionRequired') {
    return failure('attentionNotRequired');
  }

  switch (answer) {
    case 'returnedToUsual':
      return {
        ok: true,
        value: { kind: 'clearAndRequireFreshCheckIn', area },
      };
    case 'notReturned':
    case 'notSure':
      return { ok: true, value: { kind: 'keepAndShowGuidance', area } };
    case 'selectedByMistake':
      return {
        ok: true,
        value: { kind: 'keepAndStartFreshCorrection', area },
      };
  }
}

export function reduceAttentionCorrection({
  area,
  currentStatus,
  correctionContext,
  correctedEntry,
}: AttentionCorrectionInput): Result<
  AttentionCorrectionDirective,
  AttentionReductionError | CorrectionProvenanceError
> {
  if (currentStatus !== 'attentionRequired') {
    return failure('attentionNotRequired');
  }
  if (
    correctionContext.kind !== 'attentionCorrection' ||
    correctionContext.sourceArea !== area ||
    !correctionContext.submittedEntryIds.includes(
      correctedEntry.checkInEntryId,
    ) ||
    correctionContext.triggeringEntryId === correctedEntry.checkInEntryId
  ) {
    return { ok: false, error: 'invalidCorrectionProvenance' };
  }
  if (correctedEntry.area !== area) {
    return failure('areaMismatch');
  }
  if (
    !Number.isSafeInteger(correctedEntry.entryRevision) ||
    correctedEntry.entryRevision < firstEntryRevision
  ) {
    return failure('invalidEntryRevision');
  }

  if (requiresConditionalSafetyAnswer(correctedEntry)) {
    const answer = correctedEntry.conditionalSafetyAnswer;
    if (answer === undefined) {
      return failure('missingConditionalAnswer');
    }
    if (answer === 'yes' || answer === 'notSure') {
      return {
        ok: true,
        value: {
          kind: 'reaffirmAttention',
          area,
          sourceEntryId: correctedEntry.checkInEntryId,
          answer,
        },
      };
    }

    return {
      ok: true,
      value: {
        kind: 'clearAttention',
        area,
        sourceEntryId: correctedEntry.checkInEntryId,
      },
    };
  }

  if (correctedEntry.conditionalSafetyAnswer !== undefined) {
    return failure('unexpectedConditionalAnswer');
  }

  return {
    ok: true,
    value: {
      kind: 'clearAttention',
      area,
      sourceEntryId: correctedEntry.checkInEntryId,
    },
  };
}
