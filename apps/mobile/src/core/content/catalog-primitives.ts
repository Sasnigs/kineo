import type { DurationVariant } from '../domain/selection-domain';
import type { Result } from '../shared/result';

declare const catalogIdBrand: unique symbol;
export type CatalogId = string & { readonly [catalogIdBrand]: 'CatalogId' };

declare const catalogVersionBrand: unique symbol;
export type CatalogVersion = string & {
  readonly [catalogVersionBrand]: 'CatalogVersion';
};

declare const contentRevisionBrand: unique symbol;
export type ContentRevision = number & {
  readonly [contentRevisionBrand]: 'ContentRevision';
};

declare const sha256DigestBrand: unique symbol;
export type Sha256Digest = string & {
  readonly [sha256DigestBrand]: 'Sha256Digest';
};

export const buildChannels = [
  'internal_prototype',
  'public_release',
] as const;
export type BuildChannel = (typeof buildChannels)[number];

export const reviewStatuses = [
  'prototypePlaceholder',
  'draft',
  'professionallyReviewed',
  'approvedForRelease',
  'retired',
] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

export const contentRoles = [
  'primary_template',
  'secondary_module',
  'fragment',
  'movement',
] as const;
export type ContentRole = (typeof contentRoles)[number];

export const sequenceItemKinds = [
  'movement',
  'transition',
  'rest',
  'replacement_slot',
] as const;
export type SequenceItemKind = (typeof sequenceItemKinds)[number];

export const movementPositions = [
  'seated',
  'standing',
  'floor',
  'adaptable',
  'prototype_abstract',
] as const;
export type MovementPosition = (typeof movementPositions)[number];

export type SlotKind = 'secondary_focus';
export type DoseKind = 'timed' | 'repetitions';

export const alternativeReasons = [
  'uncomfortable',
  'unclear',
  'notEnoughSpace',
  'userPreference',
] as const;
export type AlternativeReason = (typeof alternativeReasons)[number];

export type CatalogValidationError =
  | Readonly<{ code: 'invalidIdentifier'; value: string }>
  | Readonly<{ code: 'invalidCatalogVersion'; value: string }>
  | Readonly<{ code: 'invalidRevision' }>
  | Readonly<{ code: 'invalidDuration'; field: string }>
  | Readonly<{ code: 'invalidDose' }>
  | Readonly<{ code: 'invalidMetadata'; field: string }>
  | Readonly<{ code: 'invalidAlternative'; field: string }>
  | Readonly<{ code: 'invalidSequenceItem'; field: string }>
  | Readonly<{ code: 'invalidArtifact'; field: string }>
  | Readonly<{ code: 'unsupportedSchemaVersion'; schemaVersion: number }>
  | Readonly<{ code: 'ineligibleCatalog'; channel: BuildChannel }>
  | Readonly<{ code: 'manifestFingerprintMismatch' }>
  | Readonly<{ code: 'duplicateRecordId'; id: CatalogId }>
  | Readonly<{ code: 'duplicateVariant'; key: string }>
  | Readonly<{ code: 'missingDurationPolicy'; variant: DurationVariant }>
  | Readonly<{ code: 'ineligibleRecord'; id: CatalogId }>
  | Readonly<{ code: 'missingReference'; id: CatalogId }>
  | Readonly<{ code: 'missingLocalization'; key: string }>
  | Readonly<{ code: 'missingAsset'; path: string }>
  | Readonly<{ code: 'assetFingerprintMismatch'; path: string }>
  | Readonly<{ code: 'invalidMedia'; assetId: string }>
  | Readonly<{ code: 'alternativeCycle'; id: CatalogId }>
  | Readonly<{ code: 'incompatibleContent'; id: CatalogId }>
  | Readonly<{ code: 'invalidCompositionRequest'; field: string }>;

const firstRevision = 1;
const semanticVersionComponentCount = 3;
const zeroVersionComponent = '0';
const englishUnitedStatesLocale = 'en-US';
const minimumPositiveValue = 1;
export const sha256DigestHexLength = 64;
const catalogIdPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const lowercaseHexPattern = /^[0-9a-f]+$/;

function isPositiveSafeInteger(candidate: number): boolean {
  return Number.isSafeInteger(candidate) && candidate >= minimumPositiveValue;
}

function isNonEmpty(candidate: string | undefined): candidate is string {
  return candidate !== undefined && candidate.trim().length > 0;
}

function frozenUnique<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...new Set(values)]);
}

export function parseCatalogId(
  candidate: string,
): Result<CatalogId, CatalogValidationError> {
  if (!catalogIdPattern.test(candidate)) {
    return {
      ok: false,
      error: { code: 'invalidIdentifier', value: candidate },
    };
  }

  return { ok: true, value: candidate as CatalogId };
}

export function parseCatalogVersion(
  candidate: string,
): Result<CatalogVersion, CatalogValidationError> {
  const components = candidate.split('.');
  const isValid =
    components.length === semanticVersionComponentCount &&
    components.every(
      (component) =>
        /^\d+$/.test(component) &&
        (component === zeroVersionComponent || !component.startsWith('0')) &&
        Number.isSafeInteger(Number(component)),
    );

  if (!isValid) {
    return {
      ok: false,
      error: { code: 'invalidCatalogVersion', value: candidate },
    };
  }

  return { ok: true, value: candidate as CatalogVersion };
}

export function parseContentRevision(
  candidate: number,
): Result<ContentRevision, CatalogValidationError> {
  if (!Number.isSafeInteger(candidate) || candidate < firstRevision) {
    return { ok: false, error: { code: 'invalidRevision' } };
  }

  return { ok: true, value: candidate as ContentRevision };
}

export function parseSha256Digest(
  candidate: string,
): Result<Sha256Digest, CatalogValidationError> {
  if (
    candidate.length !== sha256DigestHexLength ||
    !lowercaseHexPattern.test(candidate)
  ) {
    return {
      ok: false,
      error: { code: 'invalidArtifact', field: 'sha256' },
    };
  }

  return { ok: true, value: candidate as Sha256Digest };
}

export const prototypeCatalogDurations = Object.freeze({
  quick: Object.freeze({
    nominalSeconds: 300,
    minimumSeconds: 270,
    maximumSeconds: 360,
  }),
  standard: Object.freeze({
    nominalSeconds: 600,
    minimumSeconds: 480,
    maximumSeconds: 720,
  }),
});

export type DurationPolicy = Readonly<{
  variant: DurationVariant;
  nominalSeconds: number;
  minimumSeconds: number;
  maximumSeconds: number;
}>;

export function createDurationPolicy(
  input: DurationPolicy,
): Result<DurationPolicy, CatalogValidationError> {
  if (
    !isPositiveSafeInteger(input.minimumSeconds) ||
    !isPositiveSafeInteger(input.nominalSeconds) ||
    !isPositiveSafeInteger(input.maximumSeconds) ||
    input.minimumSeconds > input.nominalSeconds ||
    input.nominalSeconds > input.maximumSeconds
  ) {
    return {
      ok: false,
      error: { code: 'invalidDuration', field: input.variant },
    };
  }

  return { ok: true, value: Object.freeze({ ...input }) };
}

export type ContentMetadata = Readonly<{
  id: CatalogId;
  revision: ContentRevision;
  reviewStatus: ReviewStatus;
  locale: typeof englishUnitedStatesLocale;
  displayNameKey: string;
  accessibilityDescriptionKey?: string;
  contentOwner: string;
  reviewedBy?: string;
  reviewedAtMilliseconds?: number;
  reviewEvidenceId?: string;
  intendedBuilds: readonly BuildChannel[];
}>;

export type ContentMetadataInput = Omit<ContentMetadata, 'intendedBuilds'> &
  Readonly<{ intendedBuilds: readonly BuildChannel[] }>;

export function createContentMetadata(
  input: ContentMetadataInput,
): Result<ContentMetadata, CatalogValidationError> {
  if (input.locale !== englishUnitedStatesLocale) {
    return {
      ok: false,
      error: { code: 'invalidMetadata', field: 'locale' },
    };
  }
  if (
    !isNonEmpty(input.displayNameKey) ||
    !isNonEmpty(input.contentOwner) ||
    (input.accessibilityDescriptionKey !== undefined &&
      !isNonEmpty(input.accessibilityDescriptionKey)) ||
    (input.reviewedBy !== undefined && !isNonEmpty(input.reviewedBy)) ||
    (input.reviewEvidenceId !== undefined &&
      !isNonEmpty(input.reviewEvidenceId)) ||
    (input.reviewedAtMilliseconds !== undefined &&
      !Number.isSafeInteger(input.reviewedAtMilliseconds))
  ) {
    return {
      ok: false,
      error: { code: 'invalidMetadata', field: 'nonEmptyValue' },
    };
  }

  if (
    input.reviewStatus === 'prototypePlaceholder' &&
    (input.reviewedBy !== undefined ||
      input.reviewedAtMilliseconds !== undefined ||
      input.reviewEvidenceId !== undefined ||
      input.intendedBuilds.includes('public_release'))
  ) {
    return {
      ok: false,
      error: { code: 'invalidMetadata', field: 'prototypeReview' },
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      ...input,
      intendedBuilds: frozenUnique(input.intendedBuilds),
    }),
  };
}

export function isContentEligible(
  metadata: ContentMetadata,
  channel: BuildChannel,
): boolean {
  if (!metadata.intendedBuilds.includes(channel)) {
    return false;
  }

  if (channel === 'internal_prototype') {
    return (
      metadata.reviewStatus === 'prototypePlaceholder' ||
      metadata.reviewStatus === 'professionallyReviewed' ||
      metadata.reviewStatus === 'approvedForRelease'
    );
  }

  return (
    metadata.reviewStatus === 'approvedForRelease' &&
    metadata.reviewedBy !== undefined &&
    metadata.reviewedAtMilliseconds !== undefined &&
    metadata.reviewEvidenceId !== undefined
  );
}

export type Dose =
  | Readonly<{
      kind: 'timed';
      activeSeconds: number;
      estimatedSeconds: number;
    }>
  | Readonly<{
      kind: 'repetitions';
      repetitionCount: number;
      estimatedSeconds: number;
    }>;

export type DoseInput = Readonly<{
  kind: DoseKind;
  activeSeconds?: number;
  repetitionCount?: number;
  estimatedSeconds: number;
}>;

export function createDose(
  input: DoseInput,
): Result<Dose, CatalogValidationError> {
  if (!isPositiveSafeInteger(input.estimatedSeconds)) {
    return { ok: false, error: { code: 'invalidDose' } };
  }

  if (
    input.kind === 'timed' &&
    isPositiveSafeInteger(input.activeSeconds ?? 0) &&
    input.repetitionCount === undefined
  ) {
    return {
      ok: true,
      value: Object.freeze({
        kind: 'timed',
        activeSeconds: input.activeSeconds as number,
        estimatedSeconds: input.estimatedSeconds,
      }),
    };
  }

  if (
    input.kind === 'repetitions' &&
    isPositiveSafeInteger(input.repetitionCount ?? 0) &&
    input.activeSeconds === undefined
  ) {
    return {
      ok: true,
      value: Object.freeze({
        kind: 'repetitions',
        repetitionCount: input.repetitionCount as number,
        estimatedSeconds: input.estimatedSeconds,
      }),
    };
  }

  return { ok: false, error: { code: 'invalidDose' } };
}
