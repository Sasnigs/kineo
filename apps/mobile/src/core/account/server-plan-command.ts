import {
  areaResponses,
  areaRoles,
  bodyAreas,
  changeReports,
  conditionalSafetyAnswers,
  durationVariants,
  movementComforts,
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
  routineLevels,
  terminalRoutineStatuses,
  type BodyArea,
} from '../domain/selection-domain';
import {
  createCheckIn,
  parseLocalDay,
  type CheckIn,
} from '../persistence/persistence-domain';
import type { RoutineAreaOutcome } from '../selection/active-history';
import type { Result } from '../shared/result';
import { buildAuthoritativePlan, type ApprovedAuthoritativePlan } from './authoritative-plan';

export type ServerPlanCommandError = Readonly<{
  code: 'invalidCommand' | 'invalidServerContext' | 'contentUnavailable';
}>;

export type ServerAuthoritativePlan = Readonly<{
  decisionId: string;
  checkInId: string;
  revision: number;
  rulesVersion: string;
  catalogVersion: string;
  recommendedLevel: ApprovedAuthoritativePlan['recommendedLevel'];
  selectedLevel: ApprovedAuthoritativePlan['selectedLevel'];
  deliveredLevel: ApprovedAuthoritativePlan['deliveredLevel'];
  durationVariant: ApprovedAuthoritativePlan['duration'];
  includedAreas: readonly BodyArea[];
  snapshotTemplate: ApprovedAuthoritativePlan['snapshotTemplate'];
  canonicalDecision: ApprovedAuthoritativePlan['decision'];
}>;

export type PreparedAuthoritativePlanCommand = Readonly<{
  authorityVersion: number;
  authoritativePlan: ServerAuthoritativePlan | null;
}>;

type ServerPlanContext = Readonly<{
  version: number;
  secondaryArea: BodyArea | null;
  attentionRequiredAreas: readonly BodyArea[];
  orderedOutcomes: readonly RoutineAreaOutcome[];
}>;

const firstVersion = 1;
const firstDecisionRevision = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMember<Value extends string>(values: readonly Value[], value: unknown): value is Value {
  return typeof value === 'string' && values.includes(value as Value);
}

function isOutcome(value: unknown): value is RoutineAreaOutcome {
  return isRecord(value) &&
    isMember(bodyAreas, value.area) &&
    isMember(terminalRoutineStatuses, value.routineStatus) &&
    isMember(routineLevels, value.deliveredLevel) &&
    value.wasIncludedInDeliveredRoutine === true &&
    (value.response === undefined || isMember(areaResponses, value.response));
}

function isContext(value: unknown): value is ServerPlanContext {
  return isRecord(value) &&
    typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) && value.version >= firstVersion &&
    (value.secondaryArea === null || isMember(bodyAreas, value.secondaryArea)) &&
    Array.isArray(value.attentionRequiredAreas) &&
    value.attentionRequiredAreas.every((area) => isMember(bodyAreas, area)) &&
    new Set(value.attentionRequiredAreas).size === value.attentionRequiredAreas.length &&
    Array.isArray(value.orderedOutcomes) && value.orderedOutcomes.every(isOutcome);
}

function completedCheckIn(value: unknown): CheckIn | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' || !parseCheckInId(value.id).ok ||
    value.status !== 'completed' ||
    (value.kind !== 'normal' && value.kind !== 'attentionCorrection') ||
    !isMember(bodyAreas, value.primaryArea) ||
    (value.secondaryArea !== undefined && !isMember(bodyAreas, value.secondaryArea)) ||
    !isRecord(value.dayContext) ||
    typeof value.dayContext.localDay !== 'string' || !parseLocalDay(value.dayContext.localDay).ok ||
    typeof value.dayContext.timeZoneId !== 'string' ||
    typeof value.dayContext.calendarId !== 'string' ||
    !Array.isArray(value.entries) ||
    !value.entries.every((entry: unknown) => isRecord(entry) &&
      typeof entry.id === 'string' && parseCheckInEntryId(entry.id).ok &&
      isMember(bodyAreas, entry.area) && isMember(areaRoles, entry.role) &&
      isMember(changeReports, entry.changeReport) &&
      isMember(movementComforts, entry.movementComfort) &&
      (entry.conditionalSafetyAnswer === undefined ||
        isMember(conditionalSafetyAnswers, entry.conditionalSafetyAnswer))) ||
    (value.correctionSource !== undefined && (
      !isRecord(value.correctionSource) ||
      !isMember(bodyAreas, value.correctionSource.area) ||
      (value.correctionSource.triggeringEntryId !== undefined && (
        typeof value.correctionSource.triggeringEntryId !== 'string' ||
        !parseCheckInEntryId(value.correctionSource.triggeringEntryId).ok
      ))
    ))
  ) return undefined;
  const checked = createCheckIn(value as unknown as CheckIn);
  return checked.ok ? checked.value : undefined;
}

/** Validates committed server context before preparing a canonical SQL plan payload. */
export function prepareAuthoritativePlanCommand(
  command: Readonly<Record<string, unknown> & { kind: string }>,
  context: unknown,
): Result<PreparedAuthoritativePlanCommand, ServerPlanCommandError> {
  if (!isContext(context)) return { ok: false, error: { code: 'invalidServerContext' } };
  const checkIn = completedCheckIn(command.checkIn);
  const decisionId = typeof command.decisionId === 'string'
    ? parseSelectionDecisionId(command.decisionId)
    : undefined;
  if (
    command.kind !== 'submitCheckIn' ||
    checkIn === undefined ||
    checkIn.completedAtMilliseconds === undefined ||
    decisionId?.ok !== true ||
    typeof command.decisionRevision !== 'number' ||
    !Number.isSafeInteger(command.decisionRevision) ||
    command.decisionRevision < firstDecisionRevision ||
    !isMember(durationVariants, command.durationVariant) ||
    (command.requestedOverride !== undefined && !isMember(routineLevels, command.requestedOverride)) ||
    (command.suppressPlan !== undefined && typeof command.suppressPlan !== 'boolean')
  ) return { ok: false, error: { code: 'invalidCommand' } };

  if (command.suppressPlan === true || checkIn.kind === 'attentionCorrection') {
    return { ok: true, value: { authorityVersion: context.version, authoritativePlan: null } };
  }
  const planned = buildAuthoritativePlan({
    checkIn,
    decisionId: decisionId.value,
    revision: command.decisionRevision,
    duration: command.durationVariant,
    requestedOverride: command.requestedOverride,
    secondaryArea: context.secondaryArea ?? undefined,
    attentionRequiredAreas: context.attentionRequiredAreas,
    orderedOutcomes: context.orderedOutcomes,
    createdAtMilliseconds: checkIn.completedAtMilliseconds,
  });
  if (!planned.ok) {
    return {
      ok: false,
      error: {
        code: planned.error.code === 'contentUnavailable'
          ? 'contentUnavailable'
          : planned.error.code === 'invalidHistory' ? 'invalidServerContext' : 'invalidCommand',
      },
    };
  }
  if (planned.value.kind === 'noPlan') {
    return planned.value.reason === 'invalid_input'
      ? { ok: false, error: { code: 'invalidCommand' } }
      : { ok: true, value: { authorityVersion: context.version, authoritativePlan: null } };
  }
  const plan = planned.value;
  return {
    ok: true,
    value: {
      authorityVersion: context.version,
      authoritativePlan: {
        decisionId: plan.decisionId,
        checkInId: checkIn.id,
        revision: plan.decisionRevision,
        rulesVersion: plan.rulesVersion,
        catalogVersion: plan.catalogVersion,
        recommendedLevel: plan.recommendedLevel,
        selectedLevel: plan.selectedLevel,
        deliveredLevel: plan.deliveredLevel,
        durationVariant: plan.duration,
        includedAreas: plan.composition.includedAreas,
        snapshotTemplate: plan.snapshotTemplate,
        canonicalDecision: plan.decision,
      },
    },
  };
}
