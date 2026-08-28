import {
  routineLevelRanks,
  type BodyArea,
  type DurationVariant,
  type OmissionReason,
  type RoutineLevel,
  type SelectionDecisionId,
} from '../domain/selection-domain';
import type { Result } from '../shared/result';
import {
  hasCompleteMechanicalReview,
  type CompatibilityRule,
  type MovementDefinition,
  type PrimaryTemplateVariant,
  type SecondaryModuleVariant,
  type SequenceItem,
} from './catalog-content';
import {
  isContentEligible,
  type BuildChannel,
  type CatalogId,
  type CatalogValidationError,
  type CatalogVersion,
  type ContentMetadata,
  type ContentRevision,
  type ContentRole,
  type Sha256Digest,
} from './catalog-primitives';
import {
  validateCatalog,
  type CatalogValidationResources,
} from './catalog-validator';
import {
  createSignedCatalog,
  makeCanonicalFingerprint,
  type RoutineCatalog,
} from './routine-catalog';

declare const compositionIdBrand: unique symbol;
export type CompositionId = string & {
  readonly [compositionIdBrand]: 'CompositionId';
};

export type CompositionIdValidationError = 'invalidCompositionId';

export type CatalogCompositionRequest = Readonly<{
  decisionId: SelectionDecisionId;
  primaryArea: BodyArea;
  secondaryArea?: BodyArea;
  selectedLevel: RoutineLevel;
  duration: DurationVariant;
  catalogVersion: CatalogVersion;
  buildChannel: BuildChannel;
}>;

export const compositionStatuses = [
  'exact',
  'primary_only',
  'gentler_fallback',
  'gentler_fallback_primary_only',
] as const;
export type CompositionStatus = (typeof compositionStatuses)[number];

export const compositionUnavailableReasons = [
  'invalid_catalog',
  'catalog_version_mismatch',
  'no_approved_primary_content',
] as const;
export type CompositionUnavailableReason =
  (typeof compositionUnavailableReasons)[number];

export type VersionedContentReference = Readonly<{
  id: CatalogId;
  revision: ContentRevision;
}>;

type ResolvedSequenceItem = Exclude<
  SequenceItem,
  Readonly<{ kind: 'replacement_slot' }>
>;

export type ComposedSequenceItem = Readonly<{
  sourceOwner: VersionedContentReference;
  sourceRole: ContentRole;
  sourceArea: BodyArea;
  item: ResolvedSequenceItem;
}>;

export type ComposedRoutine = Readonly<{
  compositionId: CompositionId;
  catalogVersion: CatalogVersion;
  status: CompositionStatus;
  selectedLevel: RoutineLevel;
  deliveredLevel: RoutineLevel;
  duration: DurationVariant;
  includedAreas: readonly BodyArea[];
  omittedArea?: BodyArea;
  omissionReason?: OmissionReason;
  primaryTemplate: VersionedContentReference;
  secondaryModule?: VersionedContentReference;
  compatibilityRule?: VersionedContentReference;
  orderedItems: readonly ComposedSequenceItem[];
  nominalSeconds: number;
  minimumPathSeconds: number;
  maximumPathSeconds: number;
  fingerprint: Sha256Digest;
}>;

export type CatalogCompositionResult =
  | Readonly<{ kind: 'composed'; routine: ComposedRoutine }>
  | Readonly<{
      kind: 'unavailable';
      reason: CompositionUnavailableReason;
    }>;

type PathRange = Readonly<{
  minimumPathSeconds: number;
  maximumPathSeconds: number;
}>;

const canonicalLowercaseUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const primaryOnlyAreaCount = 1;
const maximumIncludedAreaCount = 2;
const minimumPositiveSeconds = 1;
const emptySeconds = 0;

export function parseCompositionId(
  candidate: string,
): Result<CompositionId, CompositionIdValidationError> {
  return canonicalLowercaseUuidPattern.test(candidate)
    ? { ok: true, value: candidate as CompositionId }
    : { ok: false, error: 'invalidCompositionId' };
}

export function createCatalogCompositionRequest(
  input: CatalogCompositionRequest,
): Result<CatalogCompositionRequest, CatalogValidationError> {
  if (input.secondaryArea === input.primaryArea) {
    return {
      ok: false,
      error: { code: 'invalidCompositionRequest', field: 'duplicateArea' },
    };
  }
  return { ok: true, value: Object.freeze({ ...input }) };
}

function contentReference(
  metadata: ContentMetadata,
): VersionedContentReference {
  return Object.freeze({ id: metadata.id, revision: metadata.revision });
}

function gentlerLevels(selectedLevel: RoutineLevel): readonly RoutineLevel[] {
  switch (selectedLevel) {
    case 'active':
      return ['active', 'balanced', 'gentle'];
    case 'balanced':
      return ['balanced', 'gentle'];
    case 'gentle':
      return ['gentle'];
  }
}

function invalidatesEntireCatalog(error: CatalogValidationError): boolean {
  switch (error.code) {
    case 'unsupportedSchemaVersion':
    case 'ineligibleCatalog':
    case 'manifestFingerprintMismatch':
    case 'duplicateRecordId':
    case 'duplicateVariant':
    case 'missingDurationPolicy':
    case 'ineligibleRecord':
    case 'invalidCatalogVersion':
    case 'invalidIdentifier':
    case 'invalidRevision':
    case 'invalidMetadata':
    case 'invalidArtifact':
      return true;
    case 'invalidDuration':
    case 'invalidDose':
    case 'invalidAlternative':
    case 'invalidSequenceItem':
    case 'missingReference':
    case 'missingLocalization':
    case 'missingAsset':
    case 'assetFingerprintMismatch':
    case 'invalidMedia':
    case 'alternativeCycle':
    case 'incompatibleContent':
    case 'invalidCompositionRequest':
      return false;
  }
}

function exactPrimary(
  catalog: RoutineCatalog,
  request: CatalogCompositionRequest,
  level: RoutineLevel,
): PrimaryTemplateVariant | undefined {
  return catalog.primaryTemplates.find(
    (primary) =>
      primary.area === request.primaryArea &&
      primary.level === level &&
      primary.duration === request.duration &&
      isContentEligible(primary.metadata, request.buildChannel),
  );
}

function exactModule(
  catalog: RoutineCatalog,
  request: CatalogCompositionRequest,
  secondaryArea: BodyArea,
  level: RoutineLevel,
): SecondaryModuleVariant | undefined {
  return catalog.secondaryModules.find(
    (module) =>
      module.area === secondaryArea &&
      module.level === level &&
      module.duration === request.duration &&
      isContentEligible(module.metadata, request.buildChannel),
  );
}

function exactAllowedRule(
  catalog: RoutineCatalog,
  request: CatalogCompositionRequest,
  primary: PrimaryTemplateVariant,
  module: SecondaryModuleVariant,
  level: RoutineLevel,
): CompatibilityRule | undefined {
  return catalog.compatibilityRules.find(
    (rule) =>
      rule.primaryTemplateId === primary.metadata.id &&
      rule.secondaryModuleId === module.metadata.id &&
      rule.level === level &&
      rule.duration === request.duration &&
      rule.allowed &&
      hasCompleteMechanicalReview(rule) &&
      isContentEligible(rule.metadata, request.buildChannel),
  );
}

function movementClosure(
  items: readonly SequenceItem[],
  catalog: RoutineCatalog,
): readonly MovementDefinition[] {
  const byId = new Map(
    catalog.movements.map((movement) => [movement.metadata.id, movement]),
  );
  const pending = items.flatMap((item) =>
    item.kind === 'movement' ? [item.movementId] : [],
  );
  const included = new Set<CatalogId>();
  while (pending.length > 0) {
    const currentId = pending.pop();
    if (currentId === undefined || included.has(currentId)) {
      continue;
    }
    included.add(currentId);
    const movement = byId.get(currentId);
    if (movement !== undefined) {
      pending.push(
        ...movement.alternatives.map((alternative) => alternative.movementId),
      );
    }
  }
  return catalog.movements.filter((movement) =>
    included.has(movement.metadata.id),
  );
}

function candidateIsValid(
  primary: PrimaryTemplateVariant,
  module: SecondaryModuleVariant | undefined,
  rule: CompatibilityRule | undefined,
  catalog: RoutineCatalog,
  channel: BuildChannel,
  resources: CatalogValidationResources,
): boolean {
  const fragmentIds = new Set(
    primary.items.flatMap((item) =>
      item.kind === 'replacement_slot' ? [item.slot.defaultFragmentId] : [],
    ),
  );
  const fragments = catalog.fragments.filter((fragment) =>
    fragmentIds.has(fragment.metadata.id),
  );
  const sequenceItems = [
    ...primary.items,
    ...fragments.flatMap((fragment) => fragment.items),
    ...(module?.items ?? []),
  ];
  const signed = createSignedCatalog({
    schemaVersion: catalog.schemaVersion,
    catalogVersion: catalog.catalogVersion,
    createdAtMilliseconds: catalog.createdAtMilliseconds,
    buildEligibility: catalog.buildEligibility,
    durationPolicies: catalog.durationPolicies,
    movements: movementClosure(sequenceItems, catalog),
    fragments,
    primaryTemplates: [primary],
    secondaryModules: module === undefined ? [] : [module],
    compatibilityRules: rule === undefined ? [] : [rule],
  });
  return (
    signed.ok && validateCatalog(signed.value, channel, resources).ok
  );
}

function resolvedItems(
  primary: PrimaryTemplateVariant,
  replacement: SecondaryModuleVariant | undefined,
  catalog: RoutineCatalog,
): Result<readonly ComposedSequenceItem[], CatalogValidationError> {
  const result: ComposedSequenceItem[] = [];
  for (const item of primary.items) {
    if (item.kind !== 'replacement_slot') {
      result.push(
        Object.freeze({
          sourceOwner: contentReference(primary.metadata),
          sourceRole: 'primary_template',
          sourceArea: primary.area,
          item,
        }),
      );
      continue;
    }
    if (replacement !== undefined) {
      for (const moduleItem of replacement.items) {
        if (moduleItem.kind === 'replacement_slot') {
          return {
            ok: false,
            error: {
              code: 'invalidArtifact',
              field: 'unresolvedCompositionSlot',
            },
          };
        }
        result.push(
          Object.freeze({
            sourceOwner: contentReference(replacement.metadata),
            sourceRole: 'secondary_module',
            sourceArea: replacement.area,
            item: moduleItem,
          }),
        );
      }
      continue;
    }
    const fragment = catalog.fragments.find(
      (candidate) => candidate.metadata.id === item.slot.defaultFragmentId,
    );
    if (fragment === undefined) {
      return {
        ok: false,
        error: { code: 'missingReference', id: item.slot.defaultFragmentId },
      };
    }
    for (const fragmentItem of fragment.items) {
      if (fragmentItem.kind === 'replacement_slot') {
        return {
          ok: false,
          error: {
            code: 'invalidArtifact',
            field: 'unresolvedCompositionSlot',
          },
        };
      }
      result.push(
        Object.freeze({
          sourceOwner: contentReference(fragment.metadata),
          sourceRole: 'fragment',
          sourceArea: fragment.area,
          item: fragmentItem,
        }),
      );
    }
  }
  return { ok: true, value: Object.freeze(result) };
}

function nominalSeconds(
  items: readonly ComposedSequenceItem[],
): Result<number, CatalogValidationError> {
  let total = emptySeconds;
  for (const composed of items) {
    const item = composed.item;
    total +=
      item.kind === 'movement' ? item.dose.estimatedSeconds : item.fixedSeconds;
    if (!Number.isSafeInteger(total)) {
      return {
        ok: false,
        error: { code: 'invalidDuration', field: 'overflow' },
      };
    }
  }
  return { ok: true, value: total };
}

function pathRange(
  items: readonly ComposedSequenceItem[],
  catalog: RoutineCatalog,
): Result<PathRange, CatalogValidationError> {
  const byId = new Map(
    catalog.movements.map((movement) => [movement.metadata.id, movement]),
  );
  let minimumPathSeconds = emptySeconds;
  let maximumPathSeconds = emptySeconds;
  for (const composed of items) {
    const item = composed.item;
    if (item.kind !== 'movement') {
      minimumPathSeconds += item.fixedSeconds;
      maximumPathSeconds += item.fixedSeconds;
    } else {
      const movement = byId.get(item.movementId);
      if (movement === undefined) {
        return {
          ok: false,
          error: { code: 'missingReference', id: item.movementId },
        };
      }
      const estimates = [
        item.dose.estimatedSeconds,
        ...movement.alternatives.map((alternative) =>
          alternative.dosePolicy.kind === 'explicit'
            ? alternative.dosePolicy.dose.estimatedSeconds
            : item.dose.estimatedSeconds,
        ),
      ];
      minimumPathSeconds += Math.min(...estimates);
      maximumPathSeconds += Math.max(...estimates);
    }
    if (
      !Number.isSafeInteger(minimumPathSeconds) ||
      !Number.isSafeInteger(maximumPathSeconds)
    ) {
      return {
        ok: false,
        error: { code: 'invalidDuration', field: 'overflow' },
      };
    }
  }
  return { ok: true, value: { minimumPathSeconds, maximumPathSeconds } };
}

function sequenceItemFingerprintPayload(item: ResolvedSequenceItem): object {
  if (item.kind === 'movement') {
    const dose =
      item.dose.kind === 'timed'
        ? {
            kind: item.dose.kind,
            activeSeconds: item.dose.activeSeconds,
            estimatedSeconds: item.dose.estimatedSeconds,
          }
        : {
            kind: item.dose.kind,
            repetitionCount: item.dose.repetitionCount,
            estimatedSeconds: item.dose.estimatedSeconds,
          };
    return {
      itemID: item.itemId,
      kind: item.kind,
      movementID: item.movementId,
      dose,
    };
  }
  return {
    itemID: item.itemId,
    kind: item.kind,
    fixedSeconds: item.fixedSeconds,
  };
}

export type CompositionFingerprintInput = Omit<
  ComposedRoutine,
  'compositionId' | 'fingerprint'
>;

export function computeCompositionFingerprint(
  input: CompositionFingerprintInput | ComposedRoutine,
): Result<Sha256Digest, CatalogValidationError> {
  return makeCanonicalFingerprint(
    {
      catalogVersion: input.catalogVersion,
      status: input.status,
      selectedLevel: input.selectedLevel,
      deliveredLevel: input.deliveredLevel,
      duration: input.duration,
      includedAreas: input.includedAreas,
      omittedArea: input.omittedArea,
      omissionReason: input.omissionReason,
      primaryTemplate: input.primaryTemplate,
      secondaryModule: input.secondaryModule,
      compatibilityRule: input.compatibilityRule,
      orderedItems: input.orderedItems.map((composed) => ({
        sourceOwner: composed.sourceOwner,
        sourceRole: composed.sourceRole,
        sourceArea: composed.sourceArea,
        item: sequenceItemFingerprintPayload(composed.item),
      })),
      nominalSeconds: input.nominalSeconds,
      minimumPathSeconds: input.minimumPathSeconds,
      maximumPathSeconds: input.maximumPathSeconds,
    },
    false,
  );
}

function makeRoutine(
  compositionId: CompositionId,
  status: CompositionStatus,
  request: CatalogCompositionRequest,
  deliveredLevel: RoutineLevel,
  includedAreas: readonly BodyArea[],
  omittedArea: BodyArea | undefined,
  omissionReason: OmissionReason | undefined,
  primary: PrimaryTemplateVariant,
  module: SecondaryModuleVariant | undefined,
  rule: CompatibilityRule | undefined,
  items: readonly ComposedSequenceItem[],
  catalog: RoutineCatalog,
): Result<ComposedRoutine, CatalogValidationError> {
  const range = pathRange(items, catalog);
  const nominal = nominalSeconds(items);
  if (!range.ok) {
    return range;
  }
  if (!nominal.ok) {
    return nominal;
  }
  const referencesArePaired =
    (module === undefined) === (rule === undefined);
  const isGentler =
    routineLevelRanks[deliveredLevel] < routineLevelRanks[request.selectedLevel];
  const isValidStatus =
    (status === 'exact' &&
      !isGentler &&
      omittedArea === undefined &&
      omissionReason === undefined) ||
    (status === 'gentler_fallback' &&
      isGentler &&
      omittedArea === undefined &&
      omissionReason === undefined) ||
    (status === 'primary_only' &&
      !isGentler &&
      includedAreas.length === primaryOnlyAreaCount &&
      omittedArea !== undefined &&
      omissionReason !== undefined &&
      module === undefined &&
      rule === undefined) ||
    (status === 'gentler_fallback_primary_only' &&
      isGentler &&
      includedAreas.length === primaryOnlyAreaCount &&
      omittedArea !== undefined &&
      omissionReason !== undefined &&
      module === undefined &&
      rule === undefined);
  if (
    includedAreas.length === 0 ||
    includedAreas.length > maximumIncludedAreaCount ||
    new Set(includedAreas).size !== includedAreas.length ||
    items.length === 0 ||
    routineLevelRanks[deliveredLevel] >
      routineLevelRanks[request.selectedLevel] ||
    range.value.minimumPathSeconds < minimumPositiveSeconds ||
    range.value.minimumPathSeconds > nominal.value ||
    nominal.value > range.value.maximumPathSeconds ||
    !referencesArePaired ||
    !isValidStatus ||
    (module !== undefined &&
      includedAreas.length !== maximumIncludedAreaCount) ||
    (omittedArea !== undefined && includedAreas.includes(omittedArea))
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'composedRoutine' },
    };
  }
  const valueWithoutFingerprint: CompositionFingerprintInput = Object.freeze({
    catalogVersion: catalog.catalogVersion,
    status,
    selectedLevel: request.selectedLevel,
    deliveredLevel,
    duration: request.duration,
    includedAreas: Object.freeze([...includedAreas]),
    omittedArea,
    omissionReason,
    primaryTemplate: contentReference(primary.metadata),
    secondaryModule:
      module === undefined ? undefined : contentReference(module.metadata),
    compatibilityRule:
      rule === undefined ? undefined : contentReference(rule.metadata),
    orderedItems: Object.freeze([...items]),
    nominalSeconds: nominal.value,
    minimumPathSeconds: range.value.minimumPathSeconds,
    maximumPathSeconds: range.value.maximumPathSeconds,
  });
  const fingerprint = computeCompositionFingerprint(valueWithoutFingerprint);
  if (!fingerprint.ok) {
    return fingerprint;
  }
  return {
    ok: true,
    value: Object.freeze({
      compositionId,
      ...valueWithoutFingerprint,
      fingerprint: fingerprint.value,
    }),
  };
}

function composeSecondary(
  request: CatalogCompositionRequest,
  candidateLevel: RoutineLevel,
  primary: PrimaryTemplateVariant,
  secondaryArea: BodyArea,
  catalog: RoutineCatalog,
  resources: CatalogValidationResources,
  compositionId: CompositionId,
): ComposedRoutine | undefined {
  const module = exactModule(
    catalog,
    request,
    secondaryArea,
    candidateLevel,
  );
  if (module === undefined) {
    return undefined;
  }
  const rule = exactAllowedRule(
    catalog,
    request,
    primary,
    module,
    candidateLevel,
  );
  if (
    rule === undefined ||
    !candidateIsValid(
      primary,
      module,
      rule,
      catalog,
      request.buildChannel,
      resources,
    )
  ) {
    return undefined;
  }
  const items = resolvedItems(primary, module, catalog);
  if (!items.ok) {
    return undefined;
  }
  const routine = makeRoutine(
    compositionId,
    candidateLevel === request.selectedLevel
      ? 'exact'
      : 'gentler_fallback',
    request,
    candidateLevel,
    [request.primaryArea, secondaryArea],
    undefined,
    undefined,
    primary,
    module,
    rule,
    items.value,
    catalog,
  );
  return routine.ok ? routine.value : undefined;
}

function secondaryOmissionReason(
  request: CatalogCompositionRequest,
  candidateLevel: RoutineLevel,
  catalog: RoutineCatalog,
): OmissionReason | undefined {
  if (request.secondaryArea === undefined) {
    return undefined;
  }
  return exactModule(
    catalog,
    request,
    request.secondaryArea,
    candidateLevel,
  ) === undefined
    ? 'contentUnavailable'
    : 'catalogIncompatible';
}

function composePrimaryOnly(
  request: CatalogCompositionRequest,
  candidateLevel: RoutineLevel,
  primary: PrimaryTemplateVariant,
  catalog: RoutineCatalog,
  resources: CatalogValidationResources,
  compositionId: CompositionId,
  omissionReason: OmissionReason | undefined,
): ComposedRoutine | undefined {
  if (
    !candidateIsValid(
      primary,
      undefined,
      undefined,
      catalog,
      request.buildChannel,
      resources,
    )
  ) {
    return undefined;
  }
  const items = resolvedItems(primary, undefined, catalog);
  if (!items.ok) {
    return undefined;
  }
  const isGentler = candidateLevel !== request.selectedLevel;
  const status: CompositionStatus =
    request.secondaryArea === undefined
      ? isGentler
        ? 'gentler_fallback'
        : 'exact'
      : isGentler
        ? 'gentler_fallback_primary_only'
        : 'primary_only';
  const routine = makeRoutine(
    compositionId,
    status,
    request,
    candidateLevel,
    [request.primaryArea],
    request.secondaryArea,
    omissionReason,
    primary,
    undefined,
    undefined,
    items.value,
    catalog,
  );
  return routine.ok ? routine.value : undefined;
}

export function composeRoutine(
  request: CatalogCompositionRequest,
  catalog: RoutineCatalog,
  resources: CatalogValidationResources,
  compositionId: CompositionId,
): CatalogCompositionResult {
  const validation = validateCatalog(catalog, request.buildChannel, resources);
  if (!validation.ok && invalidatesEntireCatalog(validation.error)) {
    return { kind: 'unavailable', reason: 'invalid_catalog' };
  }
  if (request.catalogVersion !== catalog.catalogVersion) {
    return { kind: 'unavailable', reason: 'catalog_version_mismatch' };
  }

  for (const candidateLevel of gentlerLevels(request.selectedLevel)) {
    const primary = exactPrimary(catalog, request, candidateLevel);
    if (primary === undefined) {
      continue;
    }
    if (request.secondaryArea !== undefined) {
      const secondary = composeSecondary(
        request,
        candidateLevel,
        primary,
        request.secondaryArea,
        catalog,
        resources,
        compositionId,
      );
      if (secondary !== undefined) {
        return { kind: 'composed', routine: secondary };
      }
    }
    const primaryOnly = composePrimaryOnly(
      request,
      candidateLevel,
      primary,
      catalog,
      resources,
      compositionId,
      secondaryOmissionReason(request, candidateLevel, catalog),
    );
    if (primaryOnly !== undefined) {
      return { kind: 'composed', routine: primaryOnly };
    }
  }
  return { kind: 'unavailable', reason: 'no_approved_primary_content' };
}
