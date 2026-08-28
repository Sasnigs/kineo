import {
  bodyAreas,
  areaResponses,
  changeReports,
  conditionalSafetyAnswers,
  durationVariants,
  movementComforts,
  parseCheckInEntryId,
  parseCheckInId,
  parseSelectionDecisionId,
  routineLevels,
  routineLevelRanks,
  safetyStatuses,
  secondaryParticipations,
  type AreaRole,
  type BodyArea,
  type CheckInId,
  type ConditionalSafetyAnswer,
  type DurationVariant,
  type OmissionReason,
  type OverrideDisposition,
  type RoutineLevel,
  type SafetyStatus,
  type SecondaryParticipation,
  type SelectionAreaCheckIn,
  type SelectionDecisionId,
  requiresConditionalSafetyAnswer,
} from '../domain/selection-domain';
import {
  isActiveUnlocked,
  prototypeActiveUnlockConfiguration,
  type ActiveHistoryState,
} from './active-history';
import { selectAreaLevel } from './area-level-rule';

export const prototypeSelectionRulesVersion =
  'selection-v1.0.0-prototype' as const;

export type SelectionSafetySnapshot = Readonly<{
  area: BodyArea;
  status: SafetyStatus;
}>;

export type PlanSelectionRequest = Readonly<{
  decisionId: SelectionDecisionId;
  checkInId: CheckInId;
  decisionRevision: number;
  primaryArea: BodyArea;
  secondaryArea?: BodyArea;
  secondaryParticipation?: SecondaryParticipation;
  checkInsByArea: Readonly<Partial<Record<BodyArea, SelectionAreaCheckIn>>>;
  safetyByArea: Readonly<Partial<Record<BodyArea, SelectionSafetySnapshot>>>;
  historyByArea: Readonly<Partial<Record<BodyArea, ActiveHistoryState>>>;
  requestedOverride?: RoutineLevel;
  duration: DurationVariant;
  rulesVersion: string;
  catalogVersion: string;
}>;

export const noPlanReasons = [
  'needs_primary_check_in',
  'needs_primary_safety_answer',
  'needs_secondary_check_in',
  'needs_secondary_safety_answer',
  'attention_required',
  'invalid_input',
] as const;
export type NoPlanReason = (typeof noPlanReasons)[number];

export type SelectionSafetyTransition = Readonly<{
  area: BodyArea;
  sourceCheckInEntryId: SelectionAreaCheckIn['checkInEntryId'];
  answer: ConditionalSafetyAnswer;
}>;

export type SelectedAreaDecision = Readonly<{
  area: BodyArea;
  role: AreaRole;
  checkInEntryId: SelectionAreaCheckIn['checkInEntryId'];
  entryRevision: number;
  baseLevel: RoutineLevel;
  activeUnlocked: boolean;
}>;

export type SelectedOmittedArea = Readonly<{
  area: BodyArea;
  reason: OmissionReason;
}>;

export type RoutineCompositionRequest = Readonly<{
  primaryArea: BodyArea;
  secondaryArea?: BodyArea;
  selectedLevel: RoutineLevel;
  duration: DurationVariant;
  rulesVersion: string;
  catalogVersion: string;
}>;

export const selectionExplanationKeys = [
  'reason.user_gentler_override',
  'reason.reported_worse',
  'reason.movement_limited',
  'reason.better_good_active',
  'reason.balanced_checkin',
  'reason.active_locked',
  'reason.secondary_more_conservative',
] as const;
export type SelectionExplanationKey =
  (typeof selectionExplanationKeys)[number];

export type SelectionExplanation = Readonly<{
  key: SelectionExplanationKey;
  parameters: Readonly<Record<string, string>>;
}>;

export type SelectionPlanNotice = Readonly<{
  key: 'notice.secondary_skipped';
  area?: BodyArea;
}>;

export type SelectedPlan = Readonly<{
  recommendedLevel: RoutineLevel;
  requestedOverride?: RoutineLevel;
  overrideDisposition: OverrideDisposition;
  selectedLevel: RoutineLevel;
  duration: DurationVariant;
  includedAreaDecisions: readonly SelectedAreaDecision[];
  omittedAreas: readonly SelectedOmittedArea[];
  compositionRequest: RoutineCompositionRequest;
  explanations: readonly SelectionExplanation[];
  notices: readonly SelectionPlanNotice[];
  pauseTodayAvailable: boolean;
}>;

export type PlanSelectionResult =
  | Readonly<{
      kind: 'noPlan';
      reason: NoPlanReason;
      affectedAreas: readonly BodyArea[];
      safetyTransitions: readonly SelectionSafetyTransition[];
    }>
  | Readonly<{
      kind: 'selected';
      plan: SelectedPlan;
    }>;

const firstRevision = 1;
const maximumExplanationCount = 2;
const areaParameter = 'area';
const levelParameter = 'level';
const thresholdParameter = 'threshold';

const bodyAreaSet: ReadonlySet<string> = new Set(bodyAreas);
const areaResponseSet: ReadonlySet<string> = new Set(areaResponses);
const changeReportSet: ReadonlySet<string> = new Set(changeReports);
const movementComfortSet: ReadonlySet<string> = new Set(movementComforts);
const conditionalSafetyAnswerSet: ReadonlySet<string> = new Set(
  conditionalSafetyAnswers,
);
const safetyStatusSet: ReadonlySet<string> = new Set(safetyStatuses);
const routineLevelSet: ReadonlySet<string> = new Set(routineLevels);
const durationVariantSet: ReadonlySet<string> = new Set(durationVariants);
const secondaryParticipationSet: ReadonlySet<string> = new Set(
  secondaryParticipations,
);

function frozenArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function noPlan(
  reason: NoPlanReason,
  affectedAreas: readonly BodyArea[] = [],
  safetyTransitions: readonly SelectionSafetyTransition[] = [],
): PlanSelectionResult {
  return Object.freeze({
    kind: 'noPlan' as const,
    reason,
    affectedAreas: frozenArray(affectedAreas),
    safetyTransitions: frozenArray(
      safetyTransitions.map((transition) => Object.freeze({ ...transition })),
    ),
  });
}

function entries<Value>(
  record: Readonly<Partial<Record<BodyArea, Value>>>,
): readonly [string, Value | undefined][] {
  return Object.entries(record) as readonly [string, Value | undefined][];
}

function hasValidArea(candidate: unknown): candidate is BodyArea {
  return typeof candidate === 'string' && bodyAreaSet.has(candidate);
}

function hasValidRevision(candidate: number): boolean {
  return Number.isSafeInteger(candidate) && candidate >= firstRevision;
}

function isStructurallyValid(request: PlanSelectionRequest): boolean {
  if (
    request.rulesVersion !== prototypeSelectionRulesVersion ||
    request.catalogVersion.trim().length === 0 ||
    !hasValidRevision(request.decisionRevision) ||
    !hasValidArea(request.primaryArea) ||
    (request.secondaryArea !== undefined &&
      !hasValidArea(request.secondaryArea)) ||
    request.primaryArea === request.secondaryArea ||
    (request.secondaryArea === undefined) !==
      (request.secondaryParticipation === undefined) ||
    (request.secondaryParticipation !== undefined &&
      !secondaryParticipationSet.has(request.secondaryParticipation)) ||
    !durationVariantSet.has(request.duration) ||
    (request.requestedOverride !== undefined &&
      !routineLevelSet.has(request.requestedOverride)) ||
    !parseSelectionDecisionId(request.decisionId).ok ||
    !parseCheckInId(request.checkInId).ok
  ) {
    return false;
  }

  const configuredAreas = new Set<BodyArea>([
    request.primaryArea,
    ...(request.secondaryArea === undefined ? [] : [request.secondaryArea]),
  ]);
  const suppliedCheckIns = entries(request.checkInsByArea);
  const checkInsAreValid = suppliedCheckIns.every(([area, checkIn]) => {
    if (checkIn === undefined) {
      return false;
    }
    const answerIsValid =
      checkIn.conditionalSafetyAnswer === undefined ||
      conditionalSafetyAnswerSet.has(checkIn.conditionalSafetyAnswer);
    return (
      hasValidArea(area) &&
      area === checkIn.area &&
      configuredAreas.has(area) &&
      hasValidRevision(checkIn.entryRevision) &&
      parseCheckInEntryId(checkIn.checkInEntryId).ok &&
      changeReportSet.has(checkIn.changeReport) &&
      movementComfortSet.has(checkIn.movementComfort) &&
      answerIsValid &&
      (requiresConditionalSafetyAnswer(checkIn) ||
        checkIn.conditionalSafetyAnswer === undefined)
    );
  });
  const entryIds = suppliedCheckIns.map(
    ([, checkIn]) => checkIn?.checkInEntryId,
  );
  if (!checkInsAreValid || new Set(entryIds).size !== entryIds.length) {
    return false;
  }

  const suppliedSafety = entries(request.safetyByArea);
  if (
    suppliedSafety.length !== bodyAreas.length ||
    !bodyAreas.every(
      (area) =>
        request.safetyByArea[area]?.area === area &&
        safetyStatusSet.has(request.safetyByArea[area]?.status ?? ''),
    )
  ) {
    return false;
  }

  return entries(request.historyByArea).every(
    ([area, history]) => {
      if (history === undefined) {
        return false;
      }
      return hasValidArea(area) &&
      area === history.area &&
      Number.isSafeInteger(history.qualifyingOutcomeCount) &&
        history.qualifyingOutcomeCount >= 0 &&
        (history.mostRecentRecordedResponse === undefined ||
          areaResponseSet.has(history.mostRecentRecordedResponse));
    },
  );
}

function rank(level: RoutineLevel): number {
  return routineLevelRanks[level];
}

export function nextGentlerLevel(level: RoutineLevel): RoutineLevel | undefined {
  switch (level) {
    case 'active': return 'balanced';
    case 'balanced': return 'gentle';
    case 'gentle': return undefined;
  }
}

function gentlerLevel(
  left: RoutineLevel,
  right: RoutineLevel,
): RoutineLevel {
  return rank(left) <= rank(right) ? left : right;
}

function orderedAffectedAreas(
  configuredAreas: readonly BodyArea[],
  affectedAreas: readonly BodyArea[],
): readonly BodyArea[] {
  const affected = new Set(affectedAreas);
  const ordered: BodyArea[] = [];
  for (const area of [...configuredAreas, ...bodyAreas]) {
    if (affected.has(area) && !ordered.includes(area)) {
      ordered.push(area);
    }
  }
  return frozenArray(ordered);
}

function areaDecision(
  checkIn: SelectionAreaCheckIn,
  role: AreaRole,
  request: PlanSelectionRequest,
): SelectedAreaDecision {
  const history = request.historyByArea[checkIn.area];
  const activeUnlocked =
    history !== undefined && isActiveUnlocked(history);
  return Object.freeze({
    area: checkIn.area,
    role,
    checkInEntryId: checkIn.checkInEntryId,
    entryRevision: checkIn.entryRevision,
    baseLevel: selectAreaLevel({
      changeReport: checkIn.changeReport,
      movementComfort: checkIn.movementComfort,
      activeUnlocked,
    }),
    activeUnlocked,
  });
}

function applyOverride(
  requested: RoutineLevel | undefined,
  recommended: RoutineLevel,
): Readonly<{ level: RoutineLevel; disposition: OverrideDisposition }> {
  if (requested === undefined) {
    return { level: recommended, disposition: 'none' };
  }
  if (rank(requested) < rank(recommended)) {
    return { level: requested, disposition: 'acceptedGentler' };
  }
  if (requested === recommended) {
    return { level: recommended, disposition: 'sameAsRecommended' };
  }
  return { level: recommended, disposition: 'rejectedHigher' };
}

function explanation(
  key: SelectionExplanationKey,
  parameters: Readonly<Record<string, string>>,
): SelectionExplanation {
  return Object.freeze({ key, parameters: Object.freeze({ ...parameters }) });
}

function checkInExplanation(
  checkIn: SelectionAreaCheckIn,
  decision: SelectedAreaDecision,
): SelectionExplanation {
  const areaParameters = { [areaParameter]: checkIn.area };
  if (checkIn.changeReport === 'worse') {
    return explanation('reason.reported_worse', areaParameters);
  }
  if (checkIn.movementComfort === 'limited') {
    return explanation('reason.movement_limited', areaParameters);
  }
  if (decision.baseLevel === 'active') {
    return explanation('reason.better_good_active', areaParameters);
  }
  if (
    checkIn.changeReport === 'better' &&
    checkIn.movementComfort === 'good' &&
    !decision.activeUnlocked
  ) {
    return explanation('reason.active_locked', {
      [areaParameter]: checkIn.area,
      [thresholdParameter]: String(
        prototypeActiveUnlockConfiguration.qualifyingOutcomeCountRequired,
      ),
    });
  }
  return explanation('reason.balanced_checkin', areaParameters);
}

function buildExplanations(
  request: PlanSelectionRequest,
  areaDecisions: readonly SelectedAreaDecision[],
  recommendedLevel: RoutineLevel,
  selectedLevel: RoutineLevel,
  overrideDisposition: OverrideDisposition,
): readonly SelectionExplanation[] {
  const result: SelectionExplanation[] = [];
  const append = (value: SelectionExplanation) => {
    if (result.length < maximumExplanationCount) {
      result.push(value);
    }
  };

  if (overrideDisposition === 'acceptedGentler') {
    append(
      explanation('reason.user_gentler_override', {
        [levelParameter]: selectedLevel,
      }),
    );
  }

  const anchor = areaDecisions.find(
    ({ baseLevel }) => baseLevel === recommendedLevel,
  );
  if (anchor === undefined) {
    return frozenArray(result);
  }
  const anchorCheckIn = request.checkInsByArea[anchor.area];
  if (anchorCheckIn === undefined) {
    return frozenArray(result);
  }
  append(checkInExplanation(anchorCheckIn, anchor));

  const primary = areaDecisions.find(({ role }) => role === 'primary');
  const secondary = areaDecisions.find(({ role }) => role === 'secondary');
  if (
    primary !== undefined &&
    secondary !== undefined &&
    rank(secondary.baseLevel) < rank(primary.baseLevel) &&
    recommendedLevel === secondary.baseLevel
  ) {
    append(
      explanation('reason.secondary_more_conservative', {
        [areaParameter]: secondary.area,
      }),
    );
  }
  return frozenArray(result);
}

function freezePlan(plan: SelectedPlan): SelectedPlan {
  return Object.freeze({
    ...plan,
    includedAreaDecisions: frozenArray(plan.includedAreaDecisions),
    omittedAreas: frozenArray(
      plan.omittedAreas.map((omitted) => Object.freeze({ ...omitted })),
    ),
    compositionRequest: Object.freeze({ ...plan.compositionRequest }),
    explanations: frozenArray(plan.explanations),
    notices: frozenArray(
      plan.notices.map((notice) => Object.freeze({ ...notice })),
    ),
  });
}

/** Selects a bounded plan using only the frozen request and prototype rules. */
export function selectPlan(request: PlanSelectionRequest): PlanSelectionResult {
  if (!isStructurallyValid(request)) {
    return noPlan('invalid_input');
  }

  const configuredAreas = [
    request.primaryArea,
    ...(request.secondaryArea === undefined ? [] : [request.secondaryArea]),
  ];
  const existingAttention = bodyAreas.filter(
    (area) => request.safetyByArea[area]?.status === 'attentionRequired',
  );
  const safetyTransitions = configuredAreas.flatMap((area) => {
    const checkIn = request.checkInsByArea[area];
    if (
      checkIn === undefined ||
      !requiresConditionalSafetyAnswer(checkIn) ||
      (checkIn.conditionalSafetyAnswer !== 'yes' &&
        checkIn.conditionalSafetyAnswer !== 'notSure')
    ) {
      return [];
    }
    return [
      Object.freeze({
        area,
        sourceCheckInEntryId: checkIn.checkInEntryId,
        answer: checkIn.conditionalSafetyAnswer,
      }),
    ];
  });
  if (existingAttention.length > 0 || safetyTransitions.length > 0) {
    return noPlan(
      'attention_required',
      orderedAffectedAreas(configuredAreas, [
        ...existingAttention,
        ...safetyTransitions.map(({ area }) => area),
      ]),
      safetyTransitions,
    );
  }

  const primaryCheckIn = request.checkInsByArea[request.primaryArea];
  if (
    primaryCheckIn !== undefined &&
    requiresConditionalSafetyAnswer(primaryCheckIn) &&
    primaryCheckIn.conditionalSafetyAnswer === undefined
  ) {
    return noPlan('needs_primary_safety_answer', [request.primaryArea]);
  }
  if (request.secondaryArea !== undefined) {
    const secondaryCheckIn = request.checkInsByArea[request.secondaryArea];
    if (
      secondaryCheckIn !== undefined &&
      requiresConditionalSafetyAnswer(secondaryCheckIn) &&
      secondaryCheckIn.conditionalSafetyAnswer === undefined
    ) {
      return noPlan('needs_secondary_safety_answer', [request.secondaryArea]);
    }
  }
  if (primaryCheckIn === undefined) {
    return noPlan('needs_primary_check_in', [request.primaryArea]);
  }

  const included: { role: AreaRole; checkIn: SelectionAreaCheckIn }[] = [
    { role: 'primary', checkIn: primaryCheckIn },
  ];
  const omittedAreas: SelectedOmittedArea[] = [];
  const notices: SelectionPlanNotice[] = [];
  if (request.secondaryArea !== undefined) {
    if (request.secondaryParticipation === 'include') {
      const secondaryCheckIn = request.checkInsByArea[request.secondaryArea];
      if (secondaryCheckIn === undefined) {
        return noPlan('needs_secondary_check_in', [request.secondaryArea]);
      }
      included.push({ role: 'secondary', checkIn: secondaryCheckIn });
    } else if (request.secondaryParticipation === 'skipForSession') {
      omittedAreas.push({
        area: request.secondaryArea,
        reason: 'secondaryUnanswered',
      });
      notices.push({
        key: 'notice.secondary_skipped',
        area: request.secondaryArea,
      });
    } else {
      return noPlan('invalid_input');
    }
  }

  const areaDecisions = included.map(({ checkIn: value, role }) =>
    areaDecision(value, role, request),
  );
  const recommendedLevel = areaDecisions
    .map(({ baseLevel }) => baseLevel)
    .reduce(gentlerLevel);
  const override = applyOverride(request.requestedOverride, recommendedLevel);
  const includedSecondary = areaDecisions.find(
    ({ role }) => role === 'secondary',
  )?.area;
  const plan = freezePlan({
    recommendedLevel,
    requestedOverride: request.requestedOverride,
    overrideDisposition: override.disposition,
    selectedLevel: override.level,
    duration: request.duration,
    includedAreaDecisions: areaDecisions,
    omittedAreas,
    compositionRequest: {
      primaryArea: request.primaryArea,
      secondaryArea: includedSecondary,
      selectedLevel: override.level,
      duration: request.duration,
      rulesVersion: request.rulesVersion,
      catalogVersion: request.catalogVersion,
    },
    explanations: buildExplanations(
      request,
      areaDecisions,
      recommendedLevel,
      override.level,
      override.disposition,
    ),
    notices,
    pauseTodayAvailable: Object.values(request.checkInsByArea).some(
      (value) =>
        value !== undefined &&
        requiresConditionalSafetyAnswer(value) &&
        value.conditionalSafetyAnswer === 'no',
    ),
  });

  return Object.freeze({ kind: 'selected' as const, plan });
}
