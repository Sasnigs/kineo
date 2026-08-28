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
