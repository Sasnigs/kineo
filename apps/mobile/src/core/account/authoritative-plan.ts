import {
  bodyAreas,
  terminalRoutineStatuses,
  type BodyArea,
  type DurationVariant,
  type RoutineLevel,
  type SelectionDecisionId,
} from '../domain/selection-domain';
import {
  makePrototypeRoutineCatalog,
  prototypeCatalogAssetDigests,
  prototypeCatalogLocalizedStrings,
} from '../content/prototype-routine-catalog';
import {
  composeRoutine,
  parseCompositionId,
  type ComposedRoutine,
} from '../content/routine-composer';
import {
  buildRoutineSessionSnapshot,
  parseRoutineSessionId,
  type RoutineSessionSnapshot,
} from '../content/routine-session-snapshot';
import {
  createSelectionDecision,
  type SelectionDecision,
} from '../persistence/decision-persistence-domain';
import { createCheckIn, type CheckIn } from '../persistence/persistence-domain';
import {
  createActiveHistoryState,
  reduceActiveHistory,
  type ActiveHistoryReductionError,
  type ActiveHistoryState,
  type RoutineAreaOutcome,
} from '../selection/active-history';
import {
  prototypeSelectionRulesVersion,
  selectPlan,
  type PlanSelectionResult,
  type SelectedPlan,
} from '../selection/plan-selector';
import type { Result } from '../shared/result';

export type AuthoritativePlanInput = Readonly<{
  checkIn: CheckIn;
  decisionId: SelectionDecisionId;
  revision: number;
  duration: DurationVariant;
  requestedOverride?: RoutineLevel;
  secondaryArea?: BodyArea;
  attentionRequiredAreas: readonly BodyArea[];
  /** Account routine-area outcomes in oldest-to-newest order. */
  orderedOutcomes: readonly RoutineAreaOutcome[];
  createdAtMilliseconds: number;
}>;

export type ApprovedAuthoritativePlan = Readonly<{
  kind: 'approved';
  decisionId: SelectionDecisionId;
  decisionRevision: number;
  rulesVersion: string;
  catalogVersion: string;
  recommendedLevel: RoutineLevel;
  selectedLevel: RoutineLevel;
  deliveredLevel: RoutineLevel;
  duration: DurationVariant;
  selectedPlan: SelectedPlan;
  composition: ComposedRoutine;
  decision: SelectionDecision;
  /** Session callers replace only sessionId, compositionId and creation time. */
  snapshotTemplate: RoutineSessionSnapshot;
}>;

export type AuthoritativePlan =
  | Extract<PlanSelectionResult, { kind: 'noPlan' }>
  | ApprovedAuthoritativePlan;

export type AuthoritativePlanError =
  | Readonly<{ code: 'invalidInput' }>
  | Readonly<{ code: 'invalidHistory'; reason: ActiveHistoryReductionError }>
  | Readonly<{ code: 'contentUnavailable' }>;

const firstEntryRevision = 1;

/** Builds the canonical plan without consulting client-selected content or levels. */
export function buildAuthoritativePlan(
  input: AuthoritativePlanInput,
): Result<AuthoritativePlan, AuthoritativePlanError> {
  const checkIn = createCheckIn(input.checkIn);
  const compositionId = parseCompositionId(input.decisionId);
  const sessionId = parseRoutineSessionId(input.decisionId);
  if (
    !checkIn.ok ||
    checkIn.value.status !== 'completed' ||
    !compositionId.ok ||
    !sessionId.ok ||
    !Number.isSafeInteger(input.createdAtMilliseconds) ||
    input.attentionRequiredAreas.some((area) => !bodyAreas.includes(area))
  ) return { ok: false, error: { code: 'invalidInput' } };

  const historyByArea: Partial<Record<BodyArea, ActiveHistoryState>> = {};
  for (const area of bodyAreas) {
    const initial = createActiveHistoryState({ area, qualifyingOutcomeCount: 0 });
    if (!initial.ok) return { ok: false, error: { code: 'invalidInput' } };
    let current = initial.value;
    for (const outcome of input.orderedOutcomes) {
      if (
        outcome.area !== area ||
        !outcome.wasIncludedInDeliveredRoutine ||
        !terminalRoutineStatuses.includes(
          outcome.routineStatus as (typeof terminalRoutineStatuses)[number],
        )
      ) continue;
      const reduced = reduceActiveHistory(current, outcome);
      if (!reduced.ok) {
        return { ok: false, error: { code: 'invalidHistory', reason: reduced.error } };
      }
      current = reduced.value;
    }
    historyByArea[area] = current;
  }

  const catalog = makePrototypeRoutineCatalog();
  const selected = selectPlan({
    decisionId: input.decisionId,
    checkInId: checkIn.value.id,
    decisionRevision: input.revision,
    primaryArea: checkIn.value.primaryArea,
    secondaryArea: input.secondaryArea,
    secondaryParticipation: input.secondaryArea === undefined
      ? undefined
      : checkIn.value.secondaryArea === input.secondaryArea
        ? 'include'
        : 'skipForSession',
    checkInsByArea: Object.fromEntries(checkIn.value.entries.map((entry) => [entry.area, {
      checkInEntryId: entry.id,
      entryRevision: firstEntryRevision,
      area: entry.area,
      changeReport: entry.changeReport,
      movementComfort: entry.movementComfort,
      conditionalSafetyAnswer: entry.conditionalSafetyAnswer,
    }])),
    safetyByArea: Object.fromEntries(bodyAreas.map((area) => [area, {
      area,
      status: input.attentionRequiredAreas.includes(area) ? 'attentionRequired' : 'normal',
    }])),
    historyByArea,
    requestedOverride: input.requestedOverride,
    duration: input.duration,
    rulesVersion: prototypeSelectionRulesVersion,
    catalogVersion: catalog.catalogVersion,
  });
  if (selected.kind === 'noPlan') return { ok: true, value: selected };

  const resources = {
    localizedStrings: prototypeCatalogLocalizedStrings(),
    assetDigestsByPath: prototypeCatalogAssetDigests(),
  };
  const composed = composeRoutine({
    decisionId: input.decisionId,
    primaryArea: selected.plan.compositionRequest.primaryArea,
    secondaryArea: selected.plan.compositionRequest.secondaryArea,
    selectedLevel: selected.plan.selectedLevel,
    duration: input.duration,
    catalogVersion: catalog.catalogVersion,
    buildChannel: 'internal_prototype',
  }, catalog, resources, compositionId.value);
  if (composed.kind !== 'composed') {
    return { ok: false, error: { code: 'contentUnavailable' } };
  }
  const composition = composed.routine;
  const plan = selected.plan;
  const decision = createSelectionDecision({
    id: input.decisionId,
    checkInId: checkIn.value.id,
    revision: input.revision,
    rulesVersion: prototypeSelectionRulesVersion,
    catalogVersionRequested: composition.catalogVersion,
    catalogVersionDelivered: composition.catalogVersion,
    outcome: 'selected',
    recommendedLevel: plan.recommendedLevel,
    requestedOverride: plan.requestedOverride,
    overrideDisposition: plan.overrideDisposition,
    selectedLevel: plan.selectedLevel,
    deliveredLevel: composition.deliveredLevel,
    duration: plan.duration,
    secondaryOmissionReason: composition.omissionReason ?? plan.omittedAreas[0]?.reason,
    validationResult: composition.status === 'exact' ? 'exact' : 'fallback',
    primaryTemplateId: composition.primaryTemplate.id,
    primaryTemplateRevision: composition.primaryTemplate.revision,
    secondaryModuleId: composition.secondaryModule?.id,
    secondaryModuleRevision: composition.secondaryModule?.revision,
    compatibilityRuleId: composition.compatibilityRule?.id,
    compositionFingerprint: composition.fingerprint,
    createdAtMilliseconds: input.createdAtMilliseconds,
    areaInputs: plan.includedAreaDecisions.map((area) => ({
      area: area.area,
      role: area.role,
      checkInEntryId: area.checkInEntryId,
      baseLevel: area.baseLevel,
      activeUnlocked: area.activeUnlocked,
      qualifyingCount: historyByArea[area.area]?.qualifyingOutcomeCount ?? 0,
      latestResponse: historyByArea[area.area]?.mostRecentRecordedResponse,
      included: composition.includedAreas.includes(area.area),
    })),
    reasons: plan.explanations.map((reason, position) => ({
      kind: 'selection',
      position,
      code: reason.key,
      parameters: reason.parameters,
    })),
    notices: plan.notices.map((notice, position) => ({
      position,
      code: notice.key,
      area: notice.area,
      parameters: {},
    })),
  });
  if (!decision.ok) return { ok: false, error: { code: 'invalidInput' } };

  const snapshot = buildRoutineSessionSnapshot({
    sessionId: sessionId.value,
    decisionId: input.decisionId,
    composition,
    catalog,
    resources,
    buildChannel: 'internal_prototype',
    rulesVersion: decision.value.rulesVersion,
    notices: decision.value.notices.map(({ code }) => code),
    explanationKeys: decision.value.reasons.map(({ code }) => code),
    explanationParameters: decision.value.reasons.map(({ parameters }) => parameters),
    createdAtMilliseconds: input.createdAtMilliseconds,
  });
  if (!snapshot.ok) return { ok: false, error: { code: 'contentUnavailable' } };

  return {
    ok: true,
    value: Object.freeze({
      kind: 'approved',
      decisionId: input.decisionId,
      decisionRevision: input.revision,
      rulesVersion: decision.value.rulesVersion,
      catalogVersion: catalog.catalogVersion,
      recommendedLevel: plan.recommendedLevel,
      selectedLevel: plan.selectedLevel,
      deliveredLevel: composition.deliveredLevel,
      duration: plan.duration,
      selectedPlan: plan,
      composition,
      decision: decision.value,
      snapshotTemplate: snapshot.value,
    }),
  };
}
