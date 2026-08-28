import type {
  BodyArea,
  DurationVariant,
  RoutineLevel,
  SelectionDecisionId,
} from '../domain/selection-domain';
import {
  bodyAreas,
  durationVariants,
  parseSelectionDecisionId,
  routineLevels,
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
import {
  contentRoles,
  createDose,
  parseCatalogId,
  parseCatalogVersion,
  parseContentRevision,
  parseSha256Digest,
} from './catalog-primitives';
import type { CatalogValidationResources } from './catalog-validator';
import { validateCatalog } from './catalog-validator';
import {
  computeCompositionFingerprint,
  parseCompositionId,
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

export type RoutineSessionSnapshotDecodingError = 'invalidRoutineSessionSnapshot';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && isNonEmpty(value);
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(nonEmptyString)
    ? Object.freeze([...value])
    : undefined;
}

function decodeDose(value: unknown): Dose | undefined {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const decoded = createDose(candidate as Dose);
  return decoded.ok ? decoded.value : undefined;
}

function decodeAlternative(value: unknown): PresentedAlternative | undefined {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const movementId = nonEmptyString(candidate.movementId)
    ? parseCatalogId(candidate.movementId)
    : undefined;
  const movementRevision = typeof candidate.movementRevision === 'number'
    ? parseContentRevision(candidate.movementRevision)
    : undefined;
  const scheduledDose = decodeDose(candidate.scheduledDose);
  if (
    movementId?.ok !== true ||
    movementRevision?.ok !== true ||
    scheduledDose === undefined ||
    !nonEmptyString(candidate.localizedTitle) ||
    !nonEmptyString(candidate.localizedInstruction) ||
    !nonEmptyString(candidate.localizedSafetyCue) ||
    !nonEmptyString(candidate.accessibleDescription) ||
    (candidate.mediaAssetId !== undefined && !nonEmptyString(candidate.mediaAssetId))
  ) return undefined;
  return Object.freeze({
    movementId: movementId.value,
    movementRevision: movementRevision.value,
    localizedTitle: candidate.localizedTitle,
    localizedInstruction: candidate.localizedInstruction,
    localizedSafetyCue: candidate.localizedSafetyCue,
    accessibleDescription: candidate.accessibleDescription,
    mediaAssetId: candidate.mediaAssetId as string | undefined,
    scheduledDose,
  });
}

function decodePresentedItem(value: unknown): PresentedRoutineItem | undefined {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const sourceOwnerId = nonEmptyString(candidate.sourceOwnerId)
    ? parseCatalogId(candidate.sourceOwnerId)
    : undefined;
  const sourceOwnerRevision = typeof candidate.sourceOwnerRevision === 'number'
    ? parseContentRevision(candidate.sourceOwnerRevision)
    : undefined;
  const itemId = nonEmptyString(candidate.itemId)
    ? parseCatalogId(candidate.itemId)
    : undefined;
  if (
    sourceOwnerId?.ok !== true ||
    sourceOwnerRevision?.ok !== true ||
    itemId?.ok !== true ||
    !contentRoles.includes(candidate.sourceRole as (typeof contentRoles)[number]) ||
    !bodyAreas.includes(candidate.sourceArea as BodyArea) ||
    !nonEmptyString(candidate.localizedTitle) ||
    !Array.isArray(candidate.availableAlternatives)
  ) return undefined;
  const source = {
    sourceOwnerId: sourceOwnerId.value,
    sourceOwnerRevision: sourceOwnerRevision.value,
    sourceRole: candidate.sourceRole as (typeof contentRoles)[number],
    sourceArea: candidate.sourceArea as BodyArea,
    itemId: itemId.value,
    localizedTitle: candidate.localizedTitle,
  };
  if (candidate.kind === 'transition' || candidate.kind === 'rest') {
    return candidate.availableAlternatives.length === 0
      ? Object.freeze({
          ...source,
          kind: candidate.kind,
          availableAlternatives: Object.freeze([] as const),
        })
      : undefined;
  }
  if (candidate.kind !== 'movement') return undefined;
  const movementId = nonEmptyString(candidate.movementId)
    ? parseCatalogId(candidate.movementId)
    : undefined;
  const movementRevision = typeof candidate.movementRevision === 'number'
    ? parseContentRevision(candidate.movementRevision)
    : undefined;
  const scheduledDose = decodeDose(candidate.scheduledDose);
  const alternatives = candidate.availableAlternatives.map(decodeAlternative);
  if (
    movementId?.ok !== true ||
    movementRevision?.ok !== true ||
    scheduledDose === undefined ||
    alternatives.some((alternative) => alternative === undefined) ||
    !nonEmptyString(candidate.localizedInstruction) ||
    !nonEmptyString(candidate.localizedSafetyCue) ||
    !nonEmptyString(candidate.accessibleDescription) ||
    (candidate.mediaAssetId !== undefined && !nonEmptyString(candidate.mediaAssetId))
  ) return undefined;
  return Object.freeze({
    ...source,
    kind: 'movement',
    movementId: movementId.value,
    movementRevision: movementRevision.value,
    localizedInstruction: candidate.localizedInstruction,
    localizedSafetyCue: candidate.localizedSafetyCue,
    accessibleDescription: candidate.accessibleDescription,
    mediaAssetId: candidate.mediaAssetId as string | undefined,
    scheduledDose,
    availableAlternatives: Object.freeze(alternatives as PresentedAlternative[]),
  });
}

export function decodeRoutineSessionSnapshot(
  source: string,
): Result<RoutineSessionSnapshot, RoutineSessionSnapshotDecodingError> {
  let candidate: Record<string, unknown> | undefined;
  try {
    candidate = record(JSON.parse(source));
  } catch {
    return { ok: false, error: 'invalidRoutineSessionSnapshot' };
  }
  if (candidate === undefined) {
    return { ok: false, error: 'invalidRoutineSessionSnapshot' };
  }
  const sessionId = nonEmptyString(candidate.sessionId)
    ? parseRoutineSessionId(candidate.sessionId)
    : undefined;
  const decisionId = nonEmptyString(candidate.decisionId)
    ? parseSelectionDecisionId(candidate.decisionId)
    : undefined;
  const compositionId = nonEmptyString(candidate.compositionId)
    ? parseCompositionId(candidate.compositionId)
    : undefined;
  const catalogVersion = nonEmptyString(candidate.catalogVersion)
    ? parseCatalogVersion(candidate.catalogVersion)
    : undefined;
  const fingerprint = nonEmptyString(candidate.fingerprint)
    ? parseSha256Digest(candidate.fingerprint)
    : undefined;
  const includedAreas = Array.isArray(candidate.includedAreas) &&
    candidate.includedAreas.every((area) => bodyAreas.includes(area as BodyArea))
    ? candidate.includedAreas as BodyArea[]
    : undefined;
  const notices = stringArray(candidate.notices);
  const explanationKeys = stringArray(candidate.presentedExplanationKeys);
  const rawParameters = candidate.presentedExplanationParameters;
  const parameters = Array.isArray(rawParameters)
    ? rawParameters.map(record)
    : undefined;
  const items = Array.isArray(candidate.items)
    ? candidate.items.map(decodePresentedItem)
    : undefined;
  const parametersAreValid = parameters !== undefined && parameters.every(
    (entry) => entry !== undefined && Object.entries(entry).every(
      ([key, value]) => isNonEmpty(key) && nonEmptyString(value),
    ),
  );
  if (
    sessionId?.ok !== true ||
    decisionId?.ok !== true ||
    compositionId?.ok !== true ||
    catalogVersion?.ok !== true ||
    fingerprint?.ok !== true ||
    !nonEmptyString(candidate.rulesVersion) ||
    !routineLevels.includes(candidate.selectedLevel as RoutineLevel) ||
    !routineLevels.includes(candidate.deliveredLevel as RoutineLevel) ||
    !durationVariants.includes(candidate.duration as DurationVariant) ||
    includedAreas === undefined ||
    includedAreas.length < minimumIncludedAreaCount ||
    includedAreas.length > maximumIncludedAreaCount ||
    new Set(includedAreas).size !== includedAreas.length ||
    notices === undefined ||
    explanationKeys === undefined ||
    !parametersAreValid ||
    parameters?.length !== explanationKeys.length ||
    items === undefined ||
    items.length === 0 ||
    items.some((item) => item === undefined) ||
    !Number.isSafeInteger(candidate.createdAtMilliseconds)
  ) return { ok: false, error: 'invalidRoutineSessionSnapshot' };
  return {
    ok: true,
    value: Object.freeze({
      sessionId: sessionId.value,
      decisionId: decisionId.value,
      compositionId: compositionId.value,
      catalogVersion: catalogVersion.value,
      rulesVersion: candidate.rulesVersion,
      fingerprint: fingerprint.value,
      selectedLevel: candidate.selectedLevel as RoutineLevel,
      deliveredLevel: candidate.deliveredLevel as RoutineLevel,
      duration: candidate.duration as DurationVariant,
      includedAreas: Object.freeze([...includedAreas]),
      notices,
      presentedExplanationKeys: explanationKeys,
      presentedExplanationParameters: Object.freeze(
        (parameters as Record<string, string>[]).map((entry) => Object.freeze({ ...entry })),
      ),
      items: Object.freeze(items as PresentedRoutineItem[]),
      createdAtMilliseconds: candidate.createdAtMilliseconds as number,
    }),
  };
}

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
