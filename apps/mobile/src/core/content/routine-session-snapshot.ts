import type {
  BodyArea,
  DurationVariant,
  RoutineLevel,
  SelectionDecisionId,
} from '../domain/selection-domain';
import type { Result } from '../shared/result';
import type { MovementDefinition } from './catalog-content';
import type {
  CatalogId,
  CatalogValidationError,
  CatalogVersion,
  BuildChannel,
  ContentRevision,
  ContentRole,
  Dose,
  Sha256Digest,
} from './catalog-primitives';
import type { CatalogValidationResources } from './catalog-validator';
import { validateCatalog } from './catalog-validator';
import {
  computeCompositionFingerprint,
  type CompositionId,
  type ComposedRoutine,
  type ComposedSequenceItem,
  type VersionedContentReference,
} from './routine-composer';
import type { RoutineCatalog } from './routine-catalog';

declare const routineSessionIdBrand: unique symbol;
export type RoutineSessionId = string & {
  readonly [routineSessionIdBrand]: 'RoutineSessionId';
};

export type RoutineSessionIdValidationError = 'invalidRoutineSessionId';

export type PresentedAlternative = Readonly<{
  movementId: CatalogId;
  movementRevision: ContentRevision;
  localizedTitle: string;
  localizedInstruction: string;
  localizedSafetyCue: string;
  accessibleDescription: string;
  mediaAssetId?: string;
  scheduledDose: Dose;
}>;

type PresentedItemSource = Readonly<{
  sourceOwnerId: CatalogId;
  sourceOwnerRevision: ContentRevision;
  sourceRole: ContentRole;
  sourceArea: BodyArea;
  itemId: CatalogId;
  localizedTitle: string;
}>;

export type PresentedRoutineItem =
  | (PresentedItemSource &
      Readonly<{
        kind: 'movement';
        movementId: CatalogId;
        movementRevision: ContentRevision;
        localizedInstruction: string;
        localizedSafetyCue: string;
        accessibleDescription: string;
        mediaAssetId?: string;
        scheduledDose: Dose;
        availableAlternatives: readonly PresentedAlternative[];
      }>)
  | (PresentedItemSource &
      Readonly<{
        kind: 'transition' | 'rest';
        availableAlternatives: readonly [];
      }>);

export type RoutineSessionSnapshot = Readonly<{
  sessionId: RoutineSessionId;
  decisionId: SelectionDecisionId;
  compositionId: CompositionId;
  catalogVersion: CatalogVersion;
  rulesVersion: string;
  fingerprint: Sha256Digest;
  selectedLevel: RoutineLevel;
  deliveredLevel: RoutineLevel;
  duration: DurationVariant;
  includedAreas: readonly BodyArea[];
  notices: readonly string[];
  presentedExplanationKeys: readonly string[];
  presentedExplanationParameters: readonly Readonly<Record<string, string>>[];
  items: readonly PresentedRoutineItem[];
  createdAtMilliseconds: number;
}>;

export type RoutineSessionSnapshotInput = Readonly<{
  sessionId: RoutineSessionId;
  decisionId: SelectionDecisionId;
  composition: ComposedRoutine;
  catalog: RoutineCatalog;
  resources: CatalogValidationResources;
  buildChannel: BuildChannel;
  rulesVersion: string;
  notices: readonly string[];
  explanationKeys: readonly string[];
  explanationParameters: readonly Readonly<Record<string, string>>[];
  createdAtMilliseconds: number;
}>;

export type RoutineAlternativeSelectionError =
  | Readonly<{ code: 'itemNotFound'; itemId: CatalogId }>
  | Readonly<{
      code: 'alternativeNotOffered';
      movementId: CatalogId;
    }>;

const canonicalLowercaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const minimumIncludedAreaCount = 1;
const maximumIncludedAreaCount = 2;
const transitionTitleKey = 'routine.transition.title';
const restTitleKey = 'routine.rest.title';

export function parseRoutineSessionId(
  candidate: string,
): Result<RoutineSessionId, RoutineSessionIdValidationError> {
  return canonicalLowercaseUuidPattern.test(candidate)
    ? { ok: true, value: candidate as RoutineSessionId }
    : { ok: false, error: 'invalidRoutineSessionId' };
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function localized(
  key: string,
  resources: CatalogValidationResources,
): Result<string, CatalogValidationError> {
  const value = resources.localizedStrings[key];
  if (value === undefined) {
    return { ok: false, error: { code: 'missingLocalization', key } };
  }
  if (!isNonEmpty(value)) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'snapshotPresentation' },
    };
  }
  return { ok: true, value };
}

function accessibilityKey(movement: MovementDefinition): string {
  return (
    movement.media?.accessibilityDescriptionKey ??
    movement.metadata.accessibilityDescriptionKey ??
    movement.metadata.displayNameKey
  );
}

function mediaAssetId(
  movement: MovementDefinition,
): Result<string | undefined, CatalogValidationError> {
  const value = movement.media?.assetId;
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  return isNonEmpty(value)
    ? { ok: true, value }
    : {
        ok: false,
        error: { code: 'invalidArtifact', field: 'snapshotPresentation' },
      };
}

function hasReference(
  reference: VersionedContentReference,
  records: readonly { metadata: { id: CatalogId; revision: ContentRevision } }[],
): boolean {
  return records.some(
    (record) =>
      record.metadata.id === reference.id &&
      record.metadata.revision === reference.revision,
  );
}

function validateCompositionReferences(
  composition: ComposedRoutine,
  catalog: RoutineCatalog,
): CatalogValidationError | undefined {
  if (!hasReference(composition.primaryTemplate, catalog.primaryTemplates)) {
    return {
      code: 'missingReference',
      id: composition.primaryTemplate.id,
    };
  }
  if (
    composition.secondaryModule !== undefined &&
    !hasReference(composition.secondaryModule, catalog.secondaryModules)
  ) {
    return {
      code: 'missingReference',
      id: composition.secondaryModule.id,
    };
  }
  if (
    composition.compatibilityRule !== undefined &&
    !hasReference(composition.compatibilityRule, catalog.compatibilityRules)
  ) {
    return {
      code: 'missingReference',
      id: composition.compatibilityRule.id,
    };
  }
  for (const item of composition.orderedItems) {
    const records =
      item.sourceRole === 'primary_template'
        ? catalog.primaryTemplates
        : item.sourceRole === 'secondary_module'
          ? catalog.secondaryModules
          : item.sourceRole === 'fragment'
            ? catalog.fragments
            : [];
    const exists = records.some(
      (record) =>
        record.metadata.id === item.sourceOwner.id &&
        record.metadata.revision === item.sourceOwner.revision &&
        record.area === item.sourceArea,
    );
    if (!exists) {
      return { code: 'missingReference', id: item.sourceOwner.id };
    }
  }
  return undefined;
}

function presentedAlternative(
  reference: MovementDefinition['alternatives'][number],
  scheduledMovementDose: Dose,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
  resources: CatalogValidationResources,
): Result<PresentedAlternative, CatalogValidationError> {
  const alternative = movementsById.get(reference.movementId);
  if (alternative === undefined) {
    return {
      ok: false,
      error: { code: 'missingReference', id: reference.movementId },
    };
  }
  const title = localized(alternative.metadata.displayNameKey, resources);
  const instruction = localized(alternative.instructionKey, resources);
  const safetyCue = localized(alternative.safetyCueKey, resources);
  const description = localized(accessibilityKey(alternative), resources);
  const assetId = mediaAssetId(alternative);
  for (const result of [title, instruction, safetyCue, description, assetId]) {
    if (!result.ok) {
      return result;
    }
  }
  if (
    !title.ok ||
    !instruction.ok ||
    !safetyCue.ok ||
    !description.ok ||
    !assetId.ok
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'snapshotPresentation' },
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      movementId: alternative.metadata.id,
      movementRevision: alternative.metadata.revision,
      localizedTitle: title.value,
      localizedInstruction: instruction.value,
      localizedSafetyCue: safetyCue.value,
      accessibleDescription: description.value,
      mediaAssetId: assetId.value,
      scheduledDose:
        reference.dosePolicy.kind === 'explicit'
          ? reference.dosePolicy.dose
          : scheduledMovementDose,
    }),
  };
}

function presentedItem(
  composed: ComposedSequenceItem,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
  resources: CatalogValidationResources,
): Result<PresentedRoutineItem, CatalogValidationError> {
  const source = {
    sourceOwnerId: composed.sourceOwner.id,
    sourceOwnerRevision: composed.sourceOwner.revision,
    sourceRole: composed.sourceRole,
    sourceArea: composed.sourceArea,
    itemId: composed.item.itemId,
  };
  if (composed.item.kind !== 'movement') {
    const title = localized(
      composed.item.kind === 'rest' ? restTitleKey : transitionTitleKey,
      resources,
    );
    if (!title.ok) {
      return title;
    }
    return {
      ok: true,
      value: Object.freeze({
        ...source,
        kind: composed.item.kind,
        localizedTitle: title.value,
        availableAlternatives: Object.freeze([] as const),
      }),
    };
  }
  const movement = movementsById.get(composed.item.movementId);
  if (movement === undefined) {
    return {
      ok: false,
      error: { code: 'missingReference', id: composed.item.movementId },
    };
  }
  const title = localized(movement.metadata.displayNameKey, resources);
  const instruction = localized(movement.instructionKey, resources);
  const safetyCue = localized(movement.safetyCueKey, resources);
  const description = localized(accessibilityKey(movement), resources);
  const assetId = mediaAssetId(movement);
  for (const result of [title, instruction, safetyCue, description, assetId]) {
    if (!result.ok) {
      return result;
    }
  }
  if (
    !title.ok ||
    !instruction.ok ||
    !safetyCue.ok ||
    !description.ok ||
    !assetId.ok
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'snapshotPresentation' },
    };
  }
  const alternatives: PresentedAlternative[] = [];
  for (const reference of movement.alternatives) {
    const alternative = presentedAlternative(
      reference,
      composed.item.dose,
      movementsById,
      resources,
    );
    if (!alternative.ok) {
      return alternative;
    }
    alternatives.push(alternative.value);
  }
  return {
    ok: true,
    value: Object.freeze({
      ...source,
      kind: 'movement',
      movementId: movement.metadata.id,
      movementRevision: movement.metadata.revision,
      localizedTitle: title.value,
      localizedInstruction: instruction.value,
      localizedSafetyCue: safetyCue.value,
      accessibleDescription: description.value,
      mediaAssetId: assetId.value,
      scheduledDose: composed.item.dose,
      availableAlternatives: Object.freeze(alternatives),
    }),
  };
}

function hasNonEmptyParameterEntries(
  parameters: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(parameters).every(
    ([key, value]) => isNonEmpty(key) && isNonEmpty(value),
  );
}

export function buildRoutineSessionSnapshot(
  input: RoutineSessionSnapshotInput,
): Result<RoutineSessionSnapshot, CatalogValidationError> {
  const catalogValidation = validateCatalog(
    input.catalog,
    input.buildChannel,
    input.resources,
  );
  if (!catalogValidation.ok) {
    return catalogValidation;
  }
  if (input.composition.catalogVersion !== input.catalog.catalogVersion) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'snapshotCatalogVersion' },
    };
  }
  const referenceFailure = validateCompositionReferences(
    input.composition,
    input.catalog,
  );
  if (referenceFailure !== undefined) {
    return { ok: false, error: referenceFailure };
  }
  const compositionFingerprint = computeCompositionFingerprint(
    input.composition,
  );
  if (
    !compositionFingerprint.ok ||
    compositionFingerprint.value !== input.composition.fingerprint
  ) {
    return {
      ok: false,
      error: {
        code: 'invalidArtifact',
        field: 'snapshotCompositionFingerprint',
      },
    };
  }

  const movementsById = new Map<CatalogId, MovementDefinition>();
  for (const movement of input.catalog.movements) {
    if (movementsById.has(movement.metadata.id)) {
      return {
        ok: false,
        error: { code: 'duplicateRecordId', id: movement.metadata.id },
      };
    }
    movementsById.set(movement.metadata.id, movement);
  }
  const items: PresentedRoutineItem[] = [];
  for (const composed of input.composition.orderedItems) {
    const item = presentedItem(composed, movementsById, input.resources);
    if (!item.ok) {
      return item;
    }
    items.push(item.value);
  }

  if (
    items.length === 0 ||
    input.composition.includedAreas.length < minimumIncludedAreaCount ||
    input.composition.includedAreas.length > maximumIncludedAreaCount ||
    new Set(input.composition.includedAreas).size !==
      input.composition.includedAreas.length ||
    input.explanationKeys.length !== input.explanationParameters.length ||
    !isNonEmpty(input.rulesVersion) ||
    input.notices.some((value) => !isNonEmpty(value)) ||
    input.explanationKeys.some((value) => !isNonEmpty(value)) ||
    !input.explanationParameters.every(hasNonEmptyParameterEntries) ||
    !Number.isSafeInteger(input.createdAtMilliseconds)
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'routineSessionSnapshot' },
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      sessionId: input.sessionId,
      decisionId: input.decisionId,
      compositionId: input.composition.compositionId,
      catalogVersion: input.catalog.catalogVersion,
      rulesVersion: input.rulesVersion,
      fingerprint: input.composition.fingerprint,
      selectedLevel: input.composition.selectedLevel,
      deliveredLevel: input.composition.deliveredLevel,
      duration: input.composition.duration,
      includedAreas: Object.freeze([...input.composition.includedAreas]),
      notices: Object.freeze([...input.notices]),
      presentedExplanationKeys: Object.freeze([...input.explanationKeys]),
      presentedExplanationParameters: Object.freeze(
        input.explanationParameters.map((parameters) =>
          Object.freeze({ ...parameters }),
        ),
      ),
      items: Object.freeze(items),
      createdAtMilliseconds: input.createdAtMilliseconds,
    }),
  };
}

export function findSnapshotAlternative(
  snapshot: RoutineSessionSnapshot,
  itemId: CatalogId,
  movementId: CatalogId,
): Result<PresentedAlternative, RoutineAlternativeSelectionError> {
  const item = snapshot.items.find((candidate) => candidate.itemId === itemId);
  if (item === undefined) {
    return { ok: false, error: { code: 'itemNotFound', itemId } };
  }
  const alternative = item.availableAlternatives.find(
    (candidate) => candidate.movementId === movementId,
  );
  return alternative === undefined
    ? {
        ok: false,
        error: { code: 'alternativeNotOffered', movementId },
      }
    : { ok: true, value: alternative };
}
