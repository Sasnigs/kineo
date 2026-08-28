import { durationVariants, type DurationVariant } from '../domain/selection-domain';
import type { Result } from '../shared/result';
import {
  hasCompleteMechanicalReview,
  type MovementDefinition,
  type PrimaryTemplateVariant,
  type RoutineFragment,
  type SecondaryModuleVariant,
  type SequenceItem,
} from './catalog-content';
import {
  isContentEligible,
  type BuildChannel,
  type CatalogId,
  type CatalogValidationError,
  type ContentMetadata,
  type DurationPolicy,
  type Sha256Digest,
} from './catalog-primitives';
import {
  computeManifestFingerprint,
  routineCatalogSchemaVersion,
  type RoutineCatalog,
} from './routine-catalog';

export type CatalogValidationResources = Readonly<{
  localizedStrings: Readonly<Record<string, string>>;
  assetDigestsByPath: Readonly<Record<string, Sha256Digest>>;
}>;

type Validation = CatalogValidationError | undefined;
type PathRange = Readonly<{
  minimumSeconds: number;
  maximumSeconds: number;
}>;
type Bounds = Readonly<{
  minimumSeconds: number;
  maximumSeconds: number;
}>;

const exactMatchCount = 1;
const emptySeconds = 0;
const allowedMediaKinds = new Set(['video', 'illustration']);

function metadataRecords(catalog: RoutineCatalog): readonly ContentMetadata[] {
  return [
    ...catalog.movements.map((record) => record.metadata),
    ...catalog.fragments.map((record) => record.metadata),
    ...catalog.primaryTemplates.map((record) => record.metadata),
    ...catalog.secondaryModules.map((record) => record.metadata),
    ...catalog.compatibilityRules.map((record) => record.metadata),
  ];
}

function requireEligible(
  metadata: ContentMetadata,
  channel: BuildChannel,
): Validation {
  return isContentEligible(metadata, channel)
    ? undefined
    : { code: 'ineligibleRecord', id: metadata.id };
}

function requireLocalization(
  key: string,
  resources: CatalogValidationResources,
): Validation {
  const value = resources.localizedStrings[key];
  return value !== undefined && value.trim().length > 0
    ? undefined
    : { code: 'missingLocalization', key };
}

function validateMetadataLocalization(
  metadata: ContentMetadata,
  resources: CatalogValidationResources,
): Validation {
  return (
    requireLocalization(metadata.displayNameKey, resources) ??
    (metadata.accessibilityDescriptionKey === undefined
      ? undefined
      : requireLocalization(metadata.accessibilityDescriptionKey, resources))
  );
}

function uniqueRecordMap<Value extends { metadata: ContentMetadata }>(
  records: readonly Value[],
): Map<CatalogId, Value> {
  return new Map(records.map((record) => [record.metadata.id, record]));
}

function durationPolicy(
  variant: DurationVariant,
  catalog: RoutineCatalog,
): DurationPolicy | undefined {
  return catalog.durationPolicies.find((policy) => policy.variant === variant);
}

function containsSeconds(
  bounds: Bounds,
  seconds: number,
): boolean {
  return bounds.minimumSeconds <= seconds && seconds <= bounds.maximumSeconds;
}

function containsRange(
  bounds: Bounds,
  range: PathRange,
): boolean {
  return (
    bounds.minimumSeconds <= range.minimumSeconds &&
    range.maximumSeconds <= bounds.maximumSeconds
  );
}

function addRanges(
  left: PathRange,
  right: PathRange,
): Result<PathRange, CatalogValidationError> {
  const minimumSeconds = left.minimumSeconds + right.minimumSeconds;
  const maximumSeconds = left.maximumSeconds + right.maximumSeconds;
  if (
    !Number.isSafeInteger(minimumSeconds) ||
    !Number.isSafeInteger(maximumSeconds)
  ) {
    return {
      ok: false,
      error: { code: 'invalidDuration', field: 'overflow' },
    };
  }
  return { ok: true, value: { minimumSeconds, maximumSeconds } };
}

function itemNominalSeconds(item: SequenceItem): number {
  switch (item.kind) {
    case 'movement':
      return item.dose.estimatedSeconds;
    case 'transition':
    case 'rest':
      return item.fixedSeconds;
    case 'replacement_slot':
      return emptySeconds;
  }
}

function sequenceNominalSeconds(
  items: readonly SequenceItem[],
): Result<number, CatalogValidationError> {
  let total = emptySeconds;
  for (const item of items) {
    total += itemNominalSeconds(item);
    if (!Number.isSafeInteger(total)) {
      return {
        ok: false,
        error: { code: 'invalidDuration', field: 'overflow' },
      };
    }
  }
  return { ok: true, value: total };
}

function itemPathRange(
  item: SequenceItem,
  area: MovementDefinition['supportedAreas'][number],
  level: MovementDefinition['supportedLevels'][number],
  channel: BuildChannel,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
): Result<PathRange, CatalogValidationError> {
  if (item.kind === 'transition' || item.kind === 'rest') {
    return {
      ok: true,
      value: {
        minimumSeconds: item.fixedSeconds,
        maximumSeconds: item.fixedSeconds,
      },
    };
  }
  if (item.kind === 'replacement_slot') {
    return {
      ok: false,
      error: { code: 'invalidSequenceItem', field: item.kind },
    };
  }
  if (item.kind !== 'movement') {
    return {
      ok: false,
      error: { code: 'invalidSequenceItem', field: item.kind },
    };
  }
  const movement = movementsById.get(item.movementId);
  if (movement === undefined) {
    return {
      ok: false,
      error: { code: 'missingReference', id: item.movementId },
    };
  }
  const eligibilityFailure = requireEligible(movement.metadata, channel);
  if (eligibilityFailure !== undefined) {
    return { ok: false, error: eligibilityFailure };
  }
  if (
    !movement.supportedAreas.includes(area) ||
    !movement.supportedLevels.includes(level)
  ) {
    return {
      ok: false,
      error: { code: 'incompatibleContent', id: movement.metadata.id },
    };
  }
  const estimates = [item.dose.estimatedSeconds];
  for (const reference of movement.alternatives) {
    const target = movementsById.get(reference.movementId);
    if (target === undefined) {
      return {
        ok: false,
        error: { code: 'missingReference', id: reference.movementId },
      };
    }
    const targetEligibilityFailure = requireEligible(target.metadata, channel);
    if (targetEligibilityFailure !== undefined) {
      return { ok: false, error: targetEligibilityFailure };
    }
    estimates.push(
      reference.dosePolicy.kind === 'explicit'
        ? reference.dosePolicy.dose.estimatedSeconds
        : item.dose.estimatedSeconds,
    );
  }
  return {
    ok: true,
    value: {
      minimumSeconds: Math.min(...estimates),
      maximumSeconds: Math.max(...estimates),
    },
  };
}

function sequencePathRange(
  items: readonly SequenceItem[],
  area: MovementDefinition['supportedAreas'][number],
  level: MovementDefinition['supportedLevels'][number],
  channel: BuildChannel,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
): Result<PathRange, CatalogValidationError> {
  let total: PathRange = {
    minimumSeconds: emptySeconds,
    maximumSeconds: emptySeconds,
  };
  for (const item of items) {
    const itemRange = itemPathRange(
      item,
      area,
      level,
      channel,
      movementsById,
    );
    if (!itemRange.ok) {
      return itemRange;
    }
    const next = addRanges(total, itemRange.value);
    if (!next.ok) {
      return next;
    }
    total = next.value;
  }
  return { ok: true, value: total };
}

function validateEnvelope(
  catalog: RoutineCatalog,
  channel: BuildChannel,
): Validation {
  if (catalog.schemaVersion !== routineCatalogSchemaVersion) {
    return {
      code: 'unsupportedSchemaVersion',
      schemaVersion: catalog.schemaVersion,
    };
  }
  if (!catalog.buildEligibility.includes(channel)) {
    return { code: 'ineligibleCatalog', channel };
  }
  const fingerprint = computeManifestFingerprint(catalog);
  if (!fingerprint.ok) {
    return fingerprint.error;
  }
  if (fingerprint.value !== catalog.manifestFingerprint) {
    return { code: 'manifestFingerprintMismatch' };
  }
  if (channel === 'public_release') {
    const prototype = metadataRecords(catalog).find(
      (metadata) => metadata.reviewStatus === 'prototypePlaceholder',
    );
    if (prototype !== undefined) {
      return { code: 'ineligibleRecord', id: prototype.id };
    }
  }
  return undefined;
}

function validateRecordIds(catalog: RoutineCatalog): Validation {
  const seen = new Set<CatalogId>();
  for (const metadata of metadataRecords(catalog)) {
    if (seen.has(metadata.id)) {
      return { code: 'duplicateRecordId', id: metadata.id };
    }
    seen.add(metadata.id);
  }
  return undefined;
}

function validateDurationPolicies(catalog: RoutineCatalog): Validation {
  for (const variant of durationVariants) {
    const matches = catalog.durationPolicies.filter(
      (policy) => policy.variant === variant,
    ).length;
    if (matches !== exactMatchCount) {
      return { code: 'missingDurationPolicy', variant };
    }
  }
  return undefined;
}

function validateVariants(
  catalog: RoutineCatalog,
  channel: BuildChannel,
): Validation {
  const keys = new Set<string>();
  const insert = (
    role: 'fragment' | 'primary_template' | 'secondary_module',
    record: RoutineFragment | PrimaryTemplateVariant | SecondaryModuleVariant,
  ): Validation => {
    if (!record.metadata.intendedBuilds.includes(channel)) {
      return undefined;
    }
    const eligibilityFailure = requireEligible(record.metadata, channel);
    if (eligibilityFailure !== undefined) {
      return eligibilityFailure;
    }
    const key = `${role}:${record.area}:${record.level}:${record.duration}`;
    if (keys.has(key)) {
      return { code: 'duplicateVariant', key };
    }
    keys.add(key);
    return undefined;
  };
  for (const [role, records] of [
    ['fragment', catalog.fragments],
    ['primary_template', catalog.primaryTemplates],
    ['secondary_module', catalog.secondaryModules],
  ] as const) {
    for (const record of records) {
      const failure = insert(role, record);
      if (failure !== undefined) {
        return failure;
      }
    }
  }

  const compatibilityKeys = new Set<string>();
  for (const rule of catalog.compatibilityRules) {
    if (!rule.metadata.intendedBuilds.includes(channel)) {
      continue;
    }
    const eligibilityFailure = requireEligible(rule.metadata, channel);
    if (eligibilityFailure !== undefined) {
      return eligibilityFailure;
    }
    const key = `compatibility:${rule.primaryArea}:${rule.secondaryArea}:${rule.level}:${rule.duration}`;
    if (compatibilityKeys.has(key)) {
      return { code: 'duplicateVariant', key };
    }
    compatibilityKeys.add(key);
  }
  return undefined;
}

function validateMedia(
  media: NonNullable<MovementDefinition['media']>,
  channel: BuildChannel,
  resources: CatalogValidationResources,
): Validation {
  const localizationFailure =
    requireLocalization(media.accessibilityDescriptionKey, resources) ??
    (media.transcriptKey === undefined
      ? undefined
      : requireLocalization(media.transcriptKey, resources));
  if (localizationFailure !== undefined) {
    return localizationFailure;
  }
  if (!allowedMediaKinds.has(media.kind)) {
    return { code: 'invalidMedia', assetId: media.assetId };
  }
  if (
    media.kind === 'video' &&
    media.captionTrackPath === undefined &&
    media.transcriptKey === undefined
  ) {
    return { code: 'invalidMedia', assetId: media.assetId };
  }
  if (channel === 'public_release' && media.licenseEvidenceId === undefined) {
    return { code: 'invalidMedia', assetId: media.assetId };
  }
  const installedDigest = resources.assetDigestsByPath[media.localBundlePath];
  if (installedDigest === undefined) {
    return { code: 'missingAsset', path: media.localBundlePath };
  }
  if (installedDigest !== media.sha256) {
    return { code: 'assetFingerprintMismatch', path: media.localBundlePath };
  }
  return undefined;
}

function validateMovements(
  catalog: RoutineCatalog,
  channel: BuildChannel,
  resources: CatalogValidationResources,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
): Validation {
  for (const movement of catalog.movements) {
    if (!movement.metadata.intendedBuilds.includes(channel)) {
      continue;
    }
    const failure =
      requireEligible(movement.metadata, channel) ??
      validateMetadataLocalization(movement.metadata, resources) ??
      requireLocalization(movement.instructionKey, resources) ??
      requireLocalization(movement.safetyCueKey, resources) ??
      (movement.spokenCueKey === undefined
        ? undefined
        : requireLocalization(movement.spokenCueKey, resources)) ??
      (movement.media === undefined
        ? undefined
        : validateMedia(movement.media, channel, resources));
    if (failure !== undefined) {
      return failure;
    }
    for (const reference of movement.alternatives) {
      const target = movementsById.get(reference.movementId);
      if (target === undefined) {
        return { code: 'missingReference', id: reference.movementId };
      }
      const targetFailure = requireEligible(target.metadata, channel);
      if (targetFailure !== undefined) {
        return targetFailure;
      }
      if (
        !sameMembers(target.supportedAreas, movement.supportedAreas) ||
        !sameMembers(target.supportedLevels, movement.supportedLevels)
      ) {
        return { code: 'invalidAlternative', field: movement.metadata.id };
      }
    }
  }
  return undefined;
}

function sameMembers<Value>(
  left: readonly Value[],
  right: readonly Value[],
): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function validateAlternativeCycles(
  catalog: RoutineCatalog,
  channel: BuildChannel,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
): Validation {
  const visiting = new Set<CatalogId>();
  const visited = new Set<CatalogId>();
  const visit = (currentId: CatalogId): Validation => {
    if (visited.has(currentId)) {
      return undefined;
    }
    if (visiting.has(currentId)) {
      return { code: 'alternativeCycle', id: currentId };
    }
    visiting.add(currentId);
    const movement = movementsById.get(currentId);
    if (movement === undefined) {
      return { code: 'missingReference', id: currentId };
    }
    for (const reference of movement.alternatives) {
      const target = movementsById.get(reference.movementId);
      if (target === undefined) {
        return { code: 'missingReference', id: reference.movementId };
      }
      const eligibilityFailure = requireEligible(target.metadata, channel);
      if (eligibilityFailure !== undefined) {
        return eligibilityFailure;
      }
      const cycleFailure = visit(reference.movementId);
      if (cycleFailure !== undefined) {
        return cycleFailure;
      }
    }
    visiting.delete(currentId);
    visited.add(currentId);
    return undefined;
  };
  for (const movement of catalog.movements) {
    if (!isContentEligible(movement.metadata, channel)) {
      continue;
    }
    const failure = visit(movement.metadata.id);
    if (failure !== undefined) {
      return failure;
    }
  }
  return undefined;
}

function primaryDefaultRange(
  primary: PrimaryTemplateVariant,
  channel: BuildChannel,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
  fragmentsById: ReadonlyMap<CatalogId, RoutineFragment>,
): Result<PathRange, CatalogValidationError> {
  let total: PathRange = {
    minimumSeconds: emptySeconds,
    maximumSeconds: emptySeconds,
  };
  for (const item of primary.items) {
    let current: Result<PathRange, CatalogValidationError>;
    if (item.kind === 'replacement_slot') {
      const fragment = fragmentsById.get(item.slot.defaultFragmentId);
      if (fragment === undefined) {
        return {
          ok: false,
          error: { code: 'missingReference', id: item.slot.defaultFragmentId },
        };
      }
      const eligibilityFailure = requireEligible(fragment.metadata, channel);
      if (eligibilityFailure !== undefined) {
        return { ok: false, error: eligibilityFailure };
      }
      if (
        fragment.area !== primary.area ||
        fragment.level !== primary.level ||
        fragment.duration !== primary.duration
      ) {
        return {
          ok: false,
          error: { code: 'incompatibleContent', id: primary.metadata.id },
        };
      }
      current = sequencePathRange(
        fragment.items,
        fragment.area,
        fragment.level,
        channel,
        movementsById,
      );
      if (!current.ok) {
        return current;
      }
      const nominal = sequenceNominalSeconds(fragment.items);
      if (!nominal.ok) {
        return nominal;
      }
      if (
        !containsRange(item.slot.budget, current.value) ||
        !containsSeconds(item.slot.budget, nominal.value)
      ) {
        return {
          ok: false,
          error: { code: 'invalidDuration', field: fragment.metadata.id },
        };
      }
    } else {
      current = itemPathRange(
        item,
        primary.area,
        primary.level,
        channel,
        movementsById,
      );
    }
    if (!current.ok) {
      return current;
    }
    const next = addRanges(total, current.value);
    if (!next.ok) {
      return next;
    }
    total = next.value;
  }
  return { ok: true, value: total };
}

function primaryDefaultNominal(
  primary: PrimaryTemplateVariant,
  channel: BuildChannel,
  fragmentsById: ReadonlyMap<CatalogId, RoutineFragment>,
): Result<number, CatalogValidationError> {
  let total = emptySeconds;
  for (const item of primary.items) {
    if (item.kind === 'replacement_slot') {
      const fragment = fragmentsById.get(item.slot.defaultFragmentId);
      if (fragment === undefined) {
        return {
          ok: false,
          error: { code: 'missingReference', id: item.slot.defaultFragmentId },
        };
      }
      const eligibilityFailure = requireEligible(fragment.metadata, channel);
      if (eligibilityFailure !== undefined) {
        return { ok: false, error: eligibilityFailure };
      }
      const nominal = sequenceNominalSeconds(fragment.items);
      if (!nominal.ok) {
        return nominal;
      }
      total += nominal.value;
    } else {
      total += itemNominalSeconds(item);
    }
    if (!Number.isSafeInteger(total)) {
      return {
        ok: false,
        error: { code: 'invalidDuration', field: 'overflow' },
      };
    }
  }
  return { ok: true, value: total };
}

function validateArtifacts(
  catalog: RoutineCatalog,
  channel: BuildChannel,
  resources: CatalogValidationResources,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
  fragmentsById: ReadonlyMap<CatalogId, RoutineFragment>,
): Validation {
  for (const fragment of catalog.fragments) {
    if (!isContentEligible(fragment.metadata, channel)) {
      continue;
    }
    const failure = validateMetadataLocalization(fragment.metadata, resources);
    if (failure !== undefined) {
      return failure;
    }
    const range = sequencePathRange(
      fragment.items,
      fragment.area,
      fragment.level,
      channel,
      movementsById,
    );
    if (!range.ok) {
      return range.error;
    }
  }
  for (const module of catalog.secondaryModules) {
    if (!isContentEligible(module.metadata, channel)) {
      continue;
    }
    const failure = validateMetadataLocalization(module.metadata, resources);
    if (failure !== undefined) {
      return failure;
    }
    const range = sequencePathRange(
      module.items,
      module.area,
      module.level,
      channel,
      movementsById,
    );
    const nominal = sequenceNominalSeconds(module.items);
    if (!range.ok) {
      return range.error;
    }
    if (!nominal.ok) {
      return nominal.error;
    }
    if (
      nominal.value !== module.nominalSeconds ||
      !containsSeconds(range.value, module.nominalSeconds)
    ) {
      return { code: 'invalidDuration', field: module.metadata.id };
    }
  }
  for (const primary of catalog.primaryTemplates) {
    if (!isContentEligible(primary.metadata, channel)) {
      continue;
    }
    const failure = validateMetadataLocalization(primary.metadata, resources);
    if (failure !== undefined) {
      return failure;
    }
    const range = primaryDefaultRange(
      primary,
      channel,
      movementsById,
      fragmentsById,
    );
    const nominal = primaryDefaultNominal(primary, channel, fragmentsById);
    if (!range.ok) {
      return range.error;
    }
    if (!nominal.ok) {
      return nominal.error;
    }
    const policy = durationPolicy(primary.duration, catalog);
    if (policy === undefined) {
      return { code: 'missingDurationPolicy', variant: primary.duration };
    }
    if (
      nominal.value !== primary.nominalSeconds ||
      !containsSeconds(range.value, primary.nominalSeconds) ||
      !containsRange(policy, range.value) ||
      !containsSeconds(policy, primary.nominalSeconds)
    ) {
      return { code: 'invalidDuration', field: primary.metadata.id };
    }
  }
  return undefined;
}

function composedRange(
  primary: PrimaryTemplateVariant,
  module: SecondaryModuleVariant,
  channel: BuildChannel,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
): Result<PathRange, CatalogValidationError> {
  let total: PathRange = {
    minimumSeconds: emptySeconds,
    maximumSeconds: emptySeconds,
  };
  for (const item of primary.items) {
    const current =
      item.kind === 'replacement_slot'
        ? sequencePathRange(
            module.items,
            module.area,
            module.level,
            channel,
            movementsById,
          )
        : itemPathRange(
            item,
            primary.area,
            primary.level,
            channel,
            movementsById,
          );
    if (!current.ok) {
      return current;
    }
    const next = addRanges(total, current.value);
    if (!next.ok) {
      return next;
    }
    total = next.value;
  }
  return { ok: true, value: total };
}

function composedNominal(
  primary: PrimaryTemplateVariant,
  module: SecondaryModuleVariant,
): Result<number, CatalogValidationError> {
  let total = emptySeconds;
  for (const item of primary.items) {
    total +=
      item.kind === 'replacement_slot'
        ? module.nominalSeconds
        : itemNominalSeconds(item);
    if (!Number.isSafeInteger(total)) {
      return {
        ok: false,
        error: { code: 'invalidDuration', field: 'overflow' },
      };
    }
  }
  return { ok: true, value: total };
}

function validateCompatibilityRules(
  catalog: RoutineCatalog,
  channel: BuildChannel,
  resources: CatalogValidationResources,
  movementsById: ReadonlyMap<CatalogId, MovementDefinition>,
  primariesById: ReadonlyMap<CatalogId, PrimaryTemplateVariant>,
  modulesById: ReadonlyMap<CatalogId, SecondaryModuleVariant>,
): Validation {
  for (const rule of catalog.compatibilityRules) {
    if (!rule.metadata.intendedBuilds.includes(channel)) {
      continue;
    }
    const failure =
      requireEligible(rule.metadata, channel) ??
      validateMetadataLocalization(rule.metadata, resources);
    if (failure !== undefined) {
      return failure;
    }
    const primary = primariesById.get(rule.primaryTemplateId);
    if (primary === undefined) {
      return { code: 'missingReference', id: rule.primaryTemplateId };
    }
    const module = modulesById.get(rule.secondaryModuleId);
    if (module === undefined) {
      return { code: 'missingReference', id: rule.secondaryModuleId };
    }
    const primaryFailure = requireEligible(primary.metadata, channel);
    const moduleFailure = requireEligible(module.metadata, channel);
    if (primaryFailure !== undefined) {
      return primaryFailure;
    }
    if (moduleFailure !== undefined) {
      return moduleFailure;
    }
    if (
      primary.area !== rule.primaryArea ||
      module.area !== rule.secondaryArea ||
      primary.level !== rule.level ||
      module.level !== rule.level ||
      primary.duration !== rule.duration ||
      module.duration !== rule.duration
    ) {
      return { code: 'incompatibleContent', id: rule.metadata.id };
    }
    const slotItem = primary.items.find(
      (item): item is Extract<SequenceItem, { kind: 'replacement_slot' }> =>
        item.kind === 'replacement_slot',
    );
    if (
      slotItem === undefined ||
      slotItem.slot.slotId !== rule.slotId ||
      slotItem.slot.kind !== module.slotKind
    ) {
      return { code: 'incompatibleContent', id: rule.metadata.id };
    }
    if (!rule.allowed) {
      continue;
    }
    if (
      !hasCompleteMechanicalReview(rule) ||
      !module.equipment.every((item) =>
        slotItem.slot.allowedEquipment.includes(item),
      ) ||
      !slotItem.slot.allowedPositions.includes(module.position)
    ) {
      return { code: 'incompatibleContent', id: rule.metadata.id };
    }
    const moduleRange = sequencePathRange(
      module.items,
      module.area,
      module.level,
      channel,
      movementsById,
    );
    if (!moduleRange.ok) {
      return moduleRange.error;
    }
    if (
      !containsRange(slotItem.slot.budget, moduleRange.value) ||
      !containsSeconds(slotItem.slot.budget, module.nominalSeconds)
    ) {
      return { code: 'incompatibleContent', id: rule.metadata.id };
    }
    const range = composedRange(primary, module, channel, movementsById);
    const nominal = composedNominal(primary, module);
    if (!range.ok) {
      return range.error;
    }
    if (!nominal.ok) {
      return nominal.error;
    }
    const policy = durationPolicy(rule.duration, catalog);
    if (policy === undefined) {
      return { code: 'missingDurationPolicy', variant: rule.duration };
    }
    if (
      !containsRange(policy, range.value) ||
      !containsSeconds(policy, nominal.value) ||
      !containsSeconds(range.value, nominal.value)
    ) {
      return { code: 'invalidDuration', field: rule.metadata.id };
    }
  }
  return undefined;
}

export function validateCatalog(
  catalog: RoutineCatalog,
  channel: BuildChannel,
  resources: CatalogValidationResources,
): Result<void, CatalogValidationError> {
  const envelopeFailure = validateEnvelope(catalog, channel);
  if (envelopeFailure !== undefined) {
    return { ok: false, error: envelopeFailure };
  }
  for (const validation of [
    validateRecordIds(catalog),
    validateDurationPolicies(catalog),
    validateVariants(catalog, channel),
  ]) {
    if (validation !== undefined) {
      return { ok: false, error: validation };
    }
  }

  const movementsById = uniqueRecordMap(catalog.movements);
  const fragmentsById = uniqueRecordMap(catalog.fragments);
  const primariesById = uniqueRecordMap(catalog.primaryTemplates);
  const modulesById = uniqueRecordMap(catalog.secondaryModules);
  const failure =
    validateMovements(
      catalog,
      channel,
      resources,
      movementsById,
    ) ??
    validateAlternativeCycles(catalog, channel, movementsById) ??
    validateArtifacts(
      catalog,
      channel,
      resources,
      movementsById,
      fragmentsById,
    ) ??
    validateCompatibilityRules(
      catalog,
      channel,
      resources,
      movementsById,
      primariesById,
      modulesById,
    );

  return failure === undefined
    ? { ok: true, value: undefined }
    : { ok: false, error: failure };
}
