import type { Result } from '../shared/result';

export const bodyAreas = ['neck', 'upperMidBack', 'lowerBack'] as const;
export type BodyArea = (typeof bodyAreas)[number];

export const areaRoles = ['primary', 'secondary'] as const;
export type AreaRole = (typeof areaRoles)[number];

export const changeReports = ['better', 'similar', 'worse'] as const;
export type ChangeReport = (typeof changeReports)[number];

export const movementComforts = ['limited', 'okay', 'good'] as const;
export type MovementComfort = (typeof movementComforts)[number];

export const conditionalSafetyAnswers = ['no', 'yes', 'notSure'] as const;
export type ConditionalSafetyAnswer =
  (typeof conditionalSafetyAnswers)[number];

export const safetyStatuses = ['normal', 'attentionRequired'] as const;
export type SafetyStatus = (typeof safetyStatuses)[number];

export const routineLevels = ['gentle', 'balanced', 'active'] as const;
export type RoutineLevel = (typeof routineLevels)[number];

export const routineLevelRanks: Readonly<Record<RoutineLevel, number>> =
  Object.freeze({
    gentle: 0,
    balanced: 1,
    active: 2,
  });

export const durationVariants = ['quick', 'standard'] as const;
export type DurationVariant = (typeof durationVariants)[number];

export const secondaryParticipations = ['include', 'skipForSession'] as const;
export type SecondaryParticipation = (typeof secondaryParticipations)[number];

export const overrideDispositions = [
  'none',
  'acceptedGentler',
  'sameAsRecommended',
  'rejectedHigher',
] as const;
export type OverrideDisposition = (typeof overrideDispositions)[number];

export const omissionReasons = [
  'secondaryUnanswered',
  'catalogIncompatible',
  'contentUnavailable',
] as const;
export type OmissionReason = (typeof omissionReasons)[number];

export const areaResponses = ['better', 'same', 'worse'] as const;
export type AreaResponse = (typeof areaResponses)[number];

export const routineStatuses = [
  'prepared',
  'inProgress',
  'paused',
  'completed',
  'stopped',
  'safetyStopped',
  'abandoned',
] as const;
export type RoutineStatus = (typeof routineStatuses)[number];

export const terminalRoutineStatuses = [
  'completed',
  'stopped',
  'safetyStopped',
  'abandoned',
] as const satisfies readonly RoutineStatus[];

declare const checkInEntryIdBrand: unique symbol;
export type CheckInEntryId = string & {
  readonly [checkInEntryIdBrand]: 'CheckInEntryId';
};

declare const checkInIdBrand: unique symbol;
export type CheckInId = string & {
  readonly [checkInIdBrand]: 'CheckInId';
};

declare const selectionDecisionIdBrand: unique symbol;
export type SelectionDecisionId = string & {
  readonly [selectionDecisionIdBrand]: 'SelectionDecisionId';
};

export type IdentifierValidationError = 'invalidIdentifier';

const canonicalLowercaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isCanonicalId(candidate: unknown): candidate is string {
  return (
    typeof candidate === 'string' && canonicalLowercaseUuidPattern.test(candidate)
  );
}

export function parseCheckInEntryId(
  candidate: unknown,
): Result<CheckInEntryId, IdentifierValidationError> {
  if (!isCanonicalId(candidate)) {
    return { ok: false, error: 'invalidIdentifier' };
  }

  return { ok: true, value: candidate as CheckInEntryId };
}

export function parseCheckInId(
  candidate: unknown,
): Result<CheckInId, IdentifierValidationError> {
  if (!isCanonicalId(candidate)) {
    return { ok: false, error: 'invalidIdentifier' };
  }

  return { ok: true, value: candidate as CheckInId };
}

export function parseSelectionDecisionId(
  candidate: unknown,
): Result<SelectionDecisionId, IdentifierValidationError> {
  if (!isCanonicalId(candidate)) {
    return { ok: false, error: 'invalidIdentifier' };
  }

  return { ok: true, value: candidate as SelectionDecisionId };
}

export type SelectionAreaCheckIn = Readonly<{
  checkInEntryId: CheckInEntryId;
  entryRevision: number;
  area: BodyArea;
  changeReport: ChangeReport;
  movementComfort: MovementComfort;
  conditionalSafetyAnswer?: ConditionalSafetyAnswer;
}>;

export function requiresConditionalSafetyAnswer(
  checkIn: Pick<SelectionAreaCheckIn, 'changeReport' | 'movementComfort'>,
): boolean {
  return (
    checkIn.changeReport === 'worse' || checkIn.movementComfort === 'limited'
  );
}
