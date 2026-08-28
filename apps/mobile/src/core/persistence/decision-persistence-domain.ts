import type {
  AreaResponse,
  AreaRole,
  BodyArea,
  CheckInEntryId,
  CheckInId,
  DurationVariant,
  OmissionReason,
  OverrideDisposition,
  RoutineLevel,
  SelectionDecisionId,
} from '../domain/selection-domain';
import { routineLevelRanks } from '../domain/selection-domain';
import type {
  CatalogId,
  CatalogVersion,
  ContentRevision,
  Sha256Digest,
} from '../content/catalog-primitives';
import type { Result } from '../shared/result';
import type { PersistenceDomainError } from './persistence-domain';

export const selectionOutcomes = ['selected', 'contentUnavailable'] as const;
export type SelectionOutcome = (typeof selectionOutcomes)[number];

export const validationResults = ['exact', 'fallback', 'unavailable'] as const;
export type ValidationResult = (typeof validationResults)[number];

export const decisionReasonKinds = ['selection', 'presented'] as const;
export type DecisionReasonKind = (typeof decisionReasonKinds)[number];

export type DecisionAreaInput = Readonly<{
  area: BodyArea;
  role: AreaRole;
  checkInEntryId: CheckInEntryId;
  baseLevel: RoutineLevel;
  activeUnlocked: boolean;
  qualifyingCount: number;
  latestResponse?: AreaResponse;
  included: boolean;
}>;

export type DecisionReason = Readonly<{
  kind: DecisionReasonKind;
  position: number;
  code: string;
  parameters: Readonly<Record<string, string>>;
}>;

export type DecisionNotice = Readonly<{
  position: number;
  code: string;
  area?: BodyArea;
  parameters: Readonly<Record<string, string>>;
}>;

export type SelectionDecision = Readonly<{
  id: SelectionDecisionId;
  checkInId: CheckInId;
  revision: number;
  rulesVersion: string;
  catalogVersionRequested: CatalogVersion;
  catalogVersionDelivered?: CatalogVersion;
  outcome: SelectionOutcome;
  recommendedLevel: RoutineLevel;
  requestedOverride?: RoutineLevel;
  overrideDisposition: OverrideDisposition;
  selectedLevel: RoutineLevel;
  deliveredLevel?: RoutineLevel;
  duration: DurationVariant;
  secondaryOmissionReason?: OmissionReason;
  validationResult: ValidationResult;
  primaryTemplateId?: CatalogId;
  primaryTemplateRevision?: ContentRevision;
  secondaryModuleId?: CatalogId;
  secondaryModuleRevision?: ContentRevision;
  compatibilityRuleId?: CatalogId;
  compositionFingerprint?: Sha256Digest;
  createdAtMilliseconds: number;
  areaInputs: readonly DecisionAreaInput[];
  reasons: readonly DecisionReason[];
  notices: readonly DecisionNotice[];
}>;

const firstRevision = 1;
const minimumAreaCount = 1;
const maximumAreaCount = 2;
const requiredPrimaryCount = 1;
const maximumSecondaryCount = 1;
const firstReasonPosition = 0;
const lastReasonPosition = 1;

function failure<Value>(field: string): Result<Value, PersistenceDomainError> {
  return { ok: false, error: { code: 'invalidDomainValue', field } };
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function hasNonEmptyParameters(
  parameters: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(parameters).every(
    ([key, value]) => isNonEmpty(key) && isNonEmpty(value),
  );
}

function createAreaInput(
  input: DecisionAreaInput,
): Result<DecisionAreaInput, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.qualifyingCount) ||
    input.qualifyingCount < 0 ||
    (input.role === 'primary' && !input.included)
  ) {
    return failure('decisionAreaInput');
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

function createReason(
  input: DecisionReason,
): Result<DecisionReason, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.position) ||
    input.position < firstReasonPosition ||
    input.position > lastReasonPosition ||
    !isNonEmpty(input.code) ||
    !hasNonEmptyParameters(input.parameters)
  ) {
    return failure('decisionReason');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      parameters: Object.freeze({ ...input.parameters }),
    }),
  };
}

function createNotice(
  input: DecisionNotice,
): Result<DecisionNotice, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.position) ||
    input.position < firstReasonPosition ||
    !isNonEmpty(input.code) ||
    !hasNonEmptyParameters(input.parameters)
  ) {
    return failure('decisionNotice');
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      parameters: Object.freeze({ ...input.parameters }),
    }),
  };
}

function hasValidOverride(input: SelectionDecision): boolean {
  const requested = input.requestedOverride;
  switch (input.overrideDisposition) {
    case 'none':
      return requested === undefined && input.selectedLevel === input.recommendedLevel;
    case 'acceptedGentler':
      return (
        requested !== undefined &&
        routineLevelRanks[requested] < routineLevelRanks[input.recommendedLevel] &&
        input.selectedLevel === requested
      );
    case 'sameAsRecommended':
      return requested === input.recommendedLevel && input.selectedLevel === input.recommendedLevel;
    case 'rejectedHigher':
      return (
        requested !== undefined &&
        routineLevelRanks[requested] > routineLevelRanks[input.recommendedLevel] &&
        input.selectedLevel === input.recommendedLevel
      );
  }
}

function hasValidOutcome(input: SelectionDecision): boolean {
  const hasSecondary = input.secondaryModuleId !== undefined;
  const secondaryFieldsAgree =
    hasSecondary === (input.secondaryModuleRevision !== undefined) &&
    hasSecondary === (input.compatibilityRuleId !== undefined);
  if (!secondaryFieldsAgree) {
    return false;
  }
  if (input.outcome === 'selected') {
    return (
      input.catalogVersionDelivered !== undefined &&
      input.deliveredLevel !== undefined &&
      input.validationResult !== 'unavailable' &&
      input.primaryTemplateId !== undefined &&
      input.primaryTemplateRevision !== undefined &&
      input.compositionFingerprint !== undefined
    );
  }
  return (
    input.catalogVersionDelivered === undefined &&
    input.deliveredLevel === undefined &&
    input.validationResult === 'unavailable' &&
    input.primaryTemplateId === undefined &&
    input.primaryTemplateRevision === undefined &&
    input.secondaryModuleId === undefined &&
    input.secondaryModuleRevision === undefined &&
    input.compatibilityRuleId === undefined &&
    input.compositionFingerprint === undefined
  );
}

export function createSelectionDecision(
  input: SelectionDecision,
): Result<SelectionDecision, PersistenceDomainError> {
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < firstRevision ||
    !Number.isSafeInteger(input.createdAtMilliseconds) ||
    !isNonEmpty(input.rulesVersion) ||
    routineLevelRanks[input.selectedLevel] >
      routineLevelRanks[input.recommendedLevel] ||
    (input.deliveredLevel !== undefined &&
      routineLevelRanks[input.deliveredLevel] >
        routineLevelRanks[input.selectedLevel]) ||
    !hasValidOverride(input) ||
    !hasValidOutcome(input)
  ) {
    return failure('selectionDecision');
  }

  const areaInputs: DecisionAreaInput[] = [];
  for (const areaInput of input.areaInputs) {
    const created = createAreaInput(areaInput);
    if (!created.ok) {
      return created;
    }
    areaInputs.push(created.value);
  }
  if (
    areaInputs.length < minimumAreaCount ||
    areaInputs.length > maximumAreaCount ||
    new Set(areaInputs.map(({ area }) => area)).size !== areaInputs.length ||
    areaInputs.filter(({ role }) => role === 'primary').length !==
      requiredPrimaryCount ||
    areaInputs.filter(({ role }) => role === 'secondary').length >
      maximumSecondaryCount
  ) {
    return failure('decisionAreaInputs');
  }

  const reasons: DecisionReason[] = [];
  for (const reason of input.reasons) {
    const created = createReason(reason);
    if (!created.ok) {
      return created;
    }
    reasons.push(created.value);
  }
  if (
    new Set(reasons.map(({ kind, position }) => `${kind}:${position}`)).size !==
    reasons.length
  ) {
    return failure('decisionReasons');
  }

  const notices: DecisionNotice[] = [];
  for (const notice of input.notices) {
    const created = createNotice(notice);
    if (!created.ok) {
      return created;
    }
    notices.push(created.value);
  }
  if (new Set(notices.map(({ position }) => position)).size !== notices.length) {
    return failure('decisionNotices');
  }

  return {
    ok: true,
    value: Object.freeze({
      ...input,
      areaInputs: Object.freeze(areaInputs),
      reasons: Object.freeze(reasons),
      notices: Object.freeze(notices),
    }),
  };
}
