import type {
  BodyArea,
  DurationVariant,
  RoutineLevel,
} from '../domain/selection-domain';
import type { Result } from '../shared/result';
import type {
  AlternativeReason,
  CatalogId,
  CatalogValidationError,
  ContentMetadata,
  Dose,
  MovementPosition,
  Sha256Digest,
  SlotKind,
} from './catalog-primitives';

export type MediaReference = Readonly<{
  assetId: string;
  kind: 'video' | 'illustration';
  localBundlePath: string;
  captionTrackPath?: string;
  transcriptKey?: string;
  accessibilityDescriptionKey: string;
  licenseEvidenceId?: string;
  sha256: Sha256Digest;
}>;

export type AlternativeDosePolicy =
  | Readonly<{ kind: 'preserve_scheduled_dose' }>
  | Readonly<{ kind: 'explicit'; dose: Dose }>;

export type AlternativeReference = Readonly<{
  movementId: CatalogId;
  reasonCodes: readonly AlternativeReason[];
  dosePolicy: AlternativeDosePolicy;
}>;

export type MovementDefinition = Readonly<{
  metadata: ContentMetadata;
  supportedAreas: readonly BodyArea[];
  supportedLevels: readonly RoutineLevel[];
  position: MovementPosition;
  equipment: readonly string[];
  instructionKey: string;
  safetyCueKey: string;
  media?: MediaReference;
  spokenCueKey?: string;
  alternatives: readonly AlternativeReference[];
}>;

export type DurationBudget = Readonly<{
  minimumSeconds: number;
  nominalSeconds: number;
  maximumSeconds: number;
}>;

export type ReplacementSlot = Readonly<{
  slotId: CatalogId;
  kind: SlotKind;
  budget: DurationBudget;
  defaultFragmentId: CatalogId;
  allowedPositions: readonly MovementPosition[];
  allowedEquipment: readonly string[];
}>;

export type SequenceItem =
  | Readonly<{
      itemId: CatalogId;
      kind: 'movement';
      movementId: CatalogId;
      dose: Dose;
    }>
  | Readonly<{
      itemId: CatalogId;
      kind: 'transition' | 'rest';
      fixedSeconds: number;
    }>
  | Readonly<{
      itemId: CatalogId;
      kind: 'replacement_slot';
      slot: ReplacementSlot;
    }>;

export type SequenceItemInput = Readonly<{
  itemId: CatalogId;
  kind: SequenceItem['kind'];
  movementId?: CatalogId;
  dose?: Dose;
  fixedSeconds?: number;
  slot?: ReplacementSlot;
}>;

type SequenceArtifact = Readonly<{
  metadata: ContentMetadata;
  area: BodyArea;
  level: RoutineLevel;
  duration: DurationVariant;
  items: readonly SequenceItem[];
}>;

export type RoutineFragment = SequenceArtifact;

export type PrimaryTemplateVariant = SequenceArtifact &
  Readonly<{ nominalSeconds: number }>;

export type SecondaryModuleVariant = SequenceArtifact &
  Readonly<{
    slotKind: SlotKind;
    nominalSeconds: number;
    position: MovementPosition;
    equipment: readonly string[];
  }>;

export type CompatibilityRule = Readonly<{
  metadata: ContentMetadata;
  primaryArea: BodyArea;
  secondaryArea: BodyArea;
  level: RoutineLevel;
  duration: DurationVariant;
  primaryTemplateId: CatalogId;
  slotId: CatalogId;
  secondaryModuleId: CatalogId;
  allowed: boolean;
  transitionOrderReviewed: boolean;
  duplicateMovementReviewed: boolean;
  equipmentReviewed: boolean;
  positionChangesReviewed: boolean;
  cueInteractionReviewed: boolean;
}>;

const noReplacementSlots = 0;
const primaryReplacementSlotCount = 1;
const minimumPositiveInteger = 1;

function isPositiveSafeInteger(candidate: number): boolean {
  return Number.isSafeInteger(candidate) && candidate >= minimumPositiveInteger;
}

function isNonEmpty(candidate: string): boolean {
  return candidate.trim().length > 0;
}

function frozenUnique<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...new Set(values)]);
}

function frozenItems(items: readonly SequenceItem[]): readonly SequenceItem[] {
  return Object.freeze([...items]);
}

export function createAlternativeReference(
  input: AlternativeReference,
): Result<AlternativeReference, CatalogValidationError> {
  if (input.reasonCodes.length === 0) {
    return {
      ok: false,
      error: { code: 'invalidAlternative', field: 'reasonCodes' },
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      ...input,
      reasonCodes: frozenUnique(input.reasonCodes),
      dosePolicy: Object.freeze({ ...input.dosePolicy }),
    }),
  };
}

export function createMovementDefinition(
  input: MovementDefinition,
): Result<MovementDefinition, CatalogValidationError> {
  if (input.supportedAreas.length === 0) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'supportedAreas' },
    };
  }
  if (input.supportedLevels.length === 0) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'supportedLevels' },
    };
  }
  if (
    input.equipment.some((item) => !isNonEmpty(item)) ||
    !isNonEmpty(input.instructionKey) ||
    !isNonEmpty(input.safetyCueKey) ||
    (input.spokenCueKey !== undefined && !isNonEmpty(input.spokenCueKey))
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'content' },
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      ...input,
      supportedAreas: frozenUnique(input.supportedAreas),
      supportedLevels: frozenUnique(input.supportedLevels),
      equipment: frozenUnique(input.equipment),
      alternatives: Object.freeze([...input.alternatives]),
    }),
  };
}

export function createDurationBudget(
  input: DurationBudget,
): Result<DurationBudget, CatalogValidationError> {
  if (
    !isPositiveSafeInteger(input.minimumSeconds) ||
    !isPositiveSafeInteger(input.nominalSeconds) ||
    !isPositiveSafeInteger(input.maximumSeconds) ||
    input.minimumSeconds > input.nominalSeconds ||
    input.nominalSeconds > input.maximumSeconds
  ) {
    return {
      ok: false,
      error: { code: 'invalidDuration', field: 'replacementSlot' },
    };
  }

  return { ok: true, value: Object.freeze({ ...input }) };
}

export function createReplacementSlot(
  input: ReplacementSlot,
): Result<ReplacementSlot, CatalogValidationError> {
  if (input.allowedPositions.length === 0) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'allowedPositions' },
    };
  }
  if (input.allowedEquipment.some((item) => !isNonEmpty(item))) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'allowedEquipment' },
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      ...input,
      allowedPositions: frozenUnique(input.allowedPositions),
      allowedEquipment: frozenUnique(input.allowedEquipment),
    }),
  };
}

export function createSequenceItem(
  input: SequenceItemInput,
): Result<SequenceItem, CatalogValidationError> {
  if (
    input.kind === 'movement' &&
    input.movementId !== undefined &&
    input.dose !== undefined &&
    input.fixedSeconds === undefined &&
    input.slot === undefined
  ) {
    return {
      ok: true,
      value: Object.freeze({
        itemId: input.itemId,
        kind: input.kind,
        movementId: input.movementId,
        dose: input.dose,
      }),
    };
  }

  if (
    (input.kind === 'transition' || input.kind === 'rest') &&
    input.movementId === undefined &&
    input.dose === undefined &&
    isPositiveSafeInteger(input.fixedSeconds ?? 0) &&
    input.slot === undefined
  ) {
    return {
      ok: true,
      value: Object.freeze({
        itemId: input.itemId,
        kind: input.kind,
        fixedSeconds: input.fixedSeconds as number,
      }),
    };
  }

  if (
    input.kind === 'replacement_slot' &&
    input.movementId === undefined &&
    input.dose === undefined &&
    input.fixedSeconds === undefined &&
    input.slot !== undefined
  ) {
    return {
      ok: true,
      value: Object.freeze({
        itemId: input.itemId,
        kind: input.kind,
        slot: input.slot,
      }),
    };
  }

  return {
    ok: false,
    error: { code: 'invalidSequenceItem', field: input.kind },
  };
}

function validateSequenceArtifact(
  items: readonly SequenceItem[],
  expectedSlotCount: number,
): CatalogValidationError | undefined {
  if (items.length === 0) {
    return { code: 'invalidArtifact', field: 'items' };
  }
  if (new Set(items.map((item) => item.itemId)).size !== items.length) {
    return { code: 'invalidArtifact', field: 'duplicateItemID' };
  }
  const slotCount = items.filter(
    (item) => item.kind === 'replacement_slot',
  ).length;
  if (slotCount !== expectedSlotCount) {
    return { code: 'invalidArtifact', field: 'slotCount' };
  }
  return undefined;
}

export function createRoutineFragment(
  input: RoutineFragment,
): Result<RoutineFragment, CatalogValidationError> {
  const failure = validateSequenceArtifact(input.items, noReplacementSlots);
  if (failure !== undefined) {
    return { ok: false, error: failure };
  }
  return {
    ok: true,
    value: Object.freeze({ ...input, items: frozenItems(input.items) }),
  };
}

export function createPrimaryTemplateVariant(
  input: PrimaryTemplateVariant,
): Result<PrimaryTemplateVariant, CatalogValidationError> {
  if (!isPositiveSafeInteger(input.nominalSeconds)) {
    return {
      ok: false,
      error: { code: 'invalidDuration', field: 'primaryTemplate' },
    };
  }
  const failure = validateSequenceArtifact(
    input.items,
    primaryReplacementSlotCount,
  );
  if (failure !== undefined) {
    return { ok: false, error: failure };
  }
  return {
    ok: true,
    value: Object.freeze({ ...input, items: frozenItems(input.items) }),
  };
}

export function createSecondaryModuleVariant(
  input: SecondaryModuleVariant,
): Result<SecondaryModuleVariant, CatalogValidationError> {
  if (!isPositiveSafeInteger(input.nominalSeconds)) {
    return {
      ok: false,
      error: { code: 'invalidDuration', field: 'secondaryModule' },
    };
  }
  if (input.equipment.some((item) => !isNonEmpty(item))) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'equipment' },
    };
  }
  const failure = validateSequenceArtifact(input.items, noReplacementSlots);
  if (failure !== undefined) {
    return { ok: false, error: failure };
  }
  return {
    ok: true,
    value: Object.freeze({
      ...input,
      equipment: frozenUnique(input.equipment),
      items: frozenItems(input.items),
    }),
  };
}

export function createCompatibilityRule(
  input: CompatibilityRule,
): Result<CompatibilityRule, CatalogValidationError> {
  if (input.primaryArea === input.secondaryArea) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'compatibilityAreas' },
    };
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

export function hasCompleteMechanicalReview(rule: CompatibilityRule): boolean {
  return (
    rule.transitionOrderReviewed &&
    rule.duplicateMovementReviewed &&
    rule.equipmentReviewed &&
    rule.positionChangesReviewed &&
    rule.cueInteractionReviewed
  );
}
