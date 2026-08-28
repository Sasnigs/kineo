import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type { Result } from '../shared/result';
import type {
  CompatibilityRule,
  MediaReference,
  MovementDefinition,
  PrimaryTemplateVariant,
  ReplacementSlot,
  RoutineFragment,
  SecondaryModuleVariant,
  SequenceItem,
} from './catalog-content';
import type {
  BuildChannel,
  CatalogValidationError,
  CatalogVersion,
  ContentMetadata,
  DurationPolicy,
  Sha256Digest,
} from './catalog-primitives';
import { parseSha256Digest } from './catalog-primitives';

export const routineCatalogSchemaVersion = 1;

export type RoutineCatalog = Readonly<{
  schemaVersion: number;
  catalogVersion: CatalogVersion;
  createdAtMilliseconds: number;
  buildEligibility: readonly BuildChannel[];
  durationPolicies: readonly DurationPolicy[];
  movements: readonly MovementDefinition[];
  fragments: readonly RoutineFragment[];
  primaryTemplates: readonly PrimaryTemplateVariant[];
  secondaryModules: readonly SecondaryModuleVariant[];
  compatibilityRules: readonly CompatibilityRule[];
  manifestFingerprint: Sha256Digest;
}>;

export type UnsignedRoutineCatalog = Omit<
  RoutineCatalog,
  'manifestFingerprint' | 'schemaVersion'
> &
  Readonly<{ schemaVersion?: number }>;

type CatalogRecord = Readonly<{ metadata: ContentMetadata }>;

const minimumSchemaVersion = 1;

function lexicalOrder(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function sortRecords<Value extends CatalogRecord>(
  records: readonly Value[],
): readonly Value[] {
  return [...records].sort((left, right) => {
    const idOrder = lexicalOrder(left.metadata.id, right.metadata.id);
    return idOrder === 0
      ? left.metadata.revision - right.metadata.revision
      : idOrder;
  });
}

function metadataPayload(metadata: ContentMetadata): object {
  return {
    id: metadata.id,
    revision: metadata.revision,
    reviewStatus: metadata.reviewStatus,
    locale: metadata.locale,
    displayNameKey: metadata.displayNameKey,
    accessibilityDescriptionKey: metadata.accessibilityDescriptionKey,
    contentOwner: metadata.contentOwner,
    reviewedBy: metadata.reviewedBy,
    reviewedAt: metadata.reviewedAtMilliseconds,
    reviewEvidenceID: metadata.reviewEvidenceId,
    intendedBuilds: metadata.intendedBuilds,
  };
}

function mediaPayload(media: MediaReference | undefined): object | undefined {
  if (media === undefined) {
    return undefined;
  }
  return {
    assetID: media.assetId,
    kind: media.kind,
    localBundlePath: media.localBundlePath,
    captionTrackPath: media.captionTrackPath,
    transcriptKey: media.transcriptKey,
    accessibilityDescriptionKey: media.accessibilityDescriptionKey,
    licenseEvidenceID: media.licenseEvidenceId,
    sha256: media.sha256,
  };
}

function dosePayload(item: Extract<SequenceItem, { kind: 'movement' }>['dose']): object {
  return item.kind === 'timed'
    ? {
        kind: item.kind,
        activeSeconds: item.activeSeconds,
        estimatedSeconds: item.estimatedSeconds,
      }
    : {
        kind: item.kind,
        repetitionCount: item.repetitionCount,
        estimatedSeconds: item.estimatedSeconds,
      };
}

function slotPayload(slot: ReplacementSlot): object {
  return {
    slotID: slot.slotId,
    kind: slot.kind,
    budget: slot.budget,
    defaultFragmentID: slot.defaultFragmentId,
    allowedPositions: slot.allowedPositions,
    allowedEquipment: slot.allowedEquipment,
  };
}

function sequenceItemPayload(item: SequenceItem): object {
  switch (item.kind) {
    case 'movement':
      return {
        itemID: item.itemId,
        kind: item.kind,
        movementID: item.movementId,
        dose: dosePayload(item.dose),
      };
    case 'transition':
    case 'rest':
      return {
        itemID: item.itemId,
        kind: item.kind,
        fixedSeconds: item.fixedSeconds,
      };
    case 'replacement_slot':
      return {
        itemID: item.itemId,
        kind: item.kind,
        slot: slotPayload(item.slot),
      };
  }
}

function movementPayload(movement: MovementDefinition): object {
  return {
    metadata: metadataPayload(movement.metadata),
    supportedAreas: movement.supportedAreas,
    supportedLevels: movement.supportedLevels,
    position: movement.position,
    equipment: movement.equipment,
    instructionKey: movement.instructionKey,
    safetyCueKey: movement.safetyCueKey,
    media: mediaPayload(movement.media),
    spokenCueKey: movement.spokenCueKey,
    alternatives: movement.alternatives.map((alternative) => ({
      movementID: alternative.movementId,
      reasonCodes: alternative.reasonCodes,
      dosePolicy:
        alternative.dosePolicy.kind === 'explicit'
          ? {
              kind: alternative.dosePolicy.kind,
              dose: dosePayload(alternative.dosePolicy.dose),
            }
          : { kind: alternative.dosePolicy.kind },
    })),
  };
}

function fragmentPayload(fragment: RoutineFragment): object {
  return {
    metadata: metadataPayload(fragment.metadata),
    area: fragment.area,
    level: fragment.level,
    duration: fragment.duration,
    items: fragment.items.map(sequenceItemPayload),
  };
}

function primaryPayload(primary: PrimaryTemplateVariant): object {
  return {
    ...fragmentPayload(primary),
    nominalSeconds: primary.nominalSeconds,
  };
}

function secondaryPayload(secondary: SecondaryModuleVariant): object {
  return {
    ...fragmentPayload(secondary),
    slotKind: secondary.slotKind,
    nominalSeconds: secondary.nominalSeconds,
    position: secondary.position,
    equipment: secondary.equipment,
  };
}

function compatibilityPayload(rule: CompatibilityRule): object {
  return {
    metadata: metadataPayload(rule.metadata),
    primaryArea: rule.primaryArea,
    secondaryArea: rule.secondaryArea,
    level: rule.level,
    duration: rule.duration,
    primaryTemplateID: rule.primaryTemplateId,
    slotID: rule.slotId,
    secondaryModuleID: rule.secondaryModuleId,
    allowed: rule.allowed,
    transitionOrderReviewed: rule.transitionOrderReviewed,
    duplicateMovementReviewed: rule.duplicateMovementReviewed,
    equipmentReviewed: rule.equipmentReviewed,
    positionChangesReviewed: rule.positionChangesReviewed,
    cueInteractionReviewed: rule.cueInteractionReviewed,
  };
}

function manifestPayload(catalog: UnsignedRoutineCatalog): object {
  return {
    schemaVersion: catalog.schemaVersion ?? routineCatalogSchemaVersion,
    catalogVersion: catalog.catalogVersion,
    createdAt: catalog.createdAtMilliseconds,
    buildEligibility: catalog.buildEligibility,
    durationPolicies: [...catalog.durationPolicies].sort((left, right) =>
      lexicalOrder(left.variant, right.variant),
    ),
    movements: sortRecords(catalog.movements).map(movementPayload),
    fragments: sortRecords(catalog.fragments).map(fragmentPayload),
    primaryTemplates: sortRecords(catalog.primaryTemplates).map(primaryPayload),
    secondaryModules: sortRecords(catalog.secondaryModules).map(secondaryPayload),
    compatibilityRules: sortRecords(catalog.compatibilityRules).map(
      compatibilityPayload,
    ),
  };
}

function normalizedCanonical(
  value: unknown,
  sortingStringArrays: boolean,
): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) =>
      normalizedCanonical(item, sortingStringArrays),
    );
    return sortingStringArrays &&
      normalized.every((item) => typeof item === 'string')
      ? [...normalized].sort()
      : normalized;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => lexicalOrder(left, right))
        .map(([key, entry]) => [
          key,
          normalizedCanonical(entry, sortingStringArrays),
        ]),
    );
  }
  return value;
}

export function makeCanonicalFingerprint(
  payload: object,
  sortingStringArrays: boolean,
): Result<Sha256Digest, CatalogValidationError> {
  // Match the verified Swift reference's JSONSerialization canonical bytes.
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(
      normalizedCanonical(payload, sortingStringArrays),
    );
  } catch {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'canonicalFingerprintPayload' },
    };
  }
  if (serialized === undefined) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'canonicalFingerprintPayload' },
    };
  }
  const canonical = serialized.replaceAll('/', '\\/');
  const digest = bytesToHex(sha256(utf8ToBytes(canonical)));
  return parseSha256Digest(digest);
}

export function computeManifestFingerprint(
  catalog: Omit<RoutineCatalog, 'manifestFingerprint'> | RoutineCatalog,
): Result<Sha256Digest, CatalogValidationError> {
  return makeCanonicalFingerprint(manifestPayload(catalog), true);
}

function deepFreezeCopy<Value>(
  value: Value,
  ancestors = new WeakSet<object>(),
): Result<Value, CatalogValidationError> {
  if (value === null || typeof value !== 'object') {
    return { ok: true, value };
  }
  if (ancestors.has(value)) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'cyclicCatalogContent' },
    };
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (const item of value) {
      const cloned = deepFreezeCopy(item, ancestors);
      if (!cloned.ok) {
        return cloned as Result<Value, CatalogValidationError>;
      }
      copy.push(cloned.value);
    }
    ancestors.delete(value);
    return {
      ok: true,
      value: Object.freeze(copy) as Value,
    };
  }
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = deepFreezeCopy(entry, ancestors);
    if (!cloned.ok) {
      return cloned as Result<Value, CatalogValidationError>;
    }
    copy[key] = cloned.value;
  }
  ancestors.delete(value);
  return {
    ok: true,
    value: Object.freeze(copy) as Value,
  };
}

export function createSignedCatalog(
  input: UnsignedRoutineCatalog,
): Result<RoutineCatalog, CatalogValidationError> {
  const schemaVersion = input.schemaVersion ?? routineCatalogSchemaVersion;
  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < minimumSchemaVersion
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'schemaVersion' },
    };
  }
  if (input.buildEligibility.length === 0) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'buildEligibility' },
    };
  }
  if (!Number.isSafeInteger(input.createdAtMilliseconds)) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'createdAt' },
    };
  }

  const copied = deepFreezeCopy({
    ...input,
    schemaVersion,
    buildEligibility: [...new Set(input.buildEligibility)],
  });
  if (!copied.ok) {
    return copied;
  }
  const fingerprint = makeCanonicalFingerprint(
    manifestPayload(copied.value),
    true,
  );
  if (!fingerprint.ok) {
    return fingerprint;
  }
  return {
    ok: true,
    value: Object.freeze({
      ...copied.value,
      manifestFingerprint: fingerprint.value,
    }),
  };
}
