import {
  bodyAreas,
  durationVariants,
  routineLevels,
  type BodyArea,
  type DurationVariant,
  type RoutineLevel,
} from '../domain/selection-domain';
import {
  createAlternativeReference,
  createCompatibilityRule,
  createDurationBudget,
  createMovementDefinition,
  createPrimaryTemplateVariant,
  createReplacementSlot,
  createRoutineFragment,
  createSecondaryModuleVariant,
  createSequenceItem,
  type CompatibilityRule,
  type MovementDefinition,
  type PrimaryTemplateVariant,
  type RoutineFragment,
  type SecondaryModuleVariant,
  type SequenceItem,
} from './catalog-content';
import {
  alternativeReasons,
  createContentMetadata,
  createDose,
  createDurationPolicy,
  parseCatalogId,
  parseCatalogVersion,
  parseContentRevision,
  parseSha256Digest,
  prototypeCatalogDurations,
  type CatalogId,
  type ContentMetadata,
  type DurationPolicy,
  type Sha256Digest,
} from './catalog-primitives';
import {
  createSignedCatalog,
  type RoutineCatalog,
} from './routine-catalog';

export const prototypeCatalogCounts = Object.freeze({
  movements: 30,
  fragments: 18,
  primaryTemplates: 18,
  secondaryModules: 18,
  compatibilityRules: 36,
});

export const prototypeCatalogAsset = Object.freeze({
  assetId: 'kineo.prototype.media.placeholder.v1',
  kind: 'illustration' as const,
  localBundlePath: 'assets/content/prototype-placeholder.svg',
  sha256: '3c6b37676f85280ba9deaa34ee755dcac4bc0df937440c3883788b0cdd6b368e',
});

const prototypeCatalogVersion = '0.1.0';
const prototypeCreatedAtMilliseconds = 1_754_524_800_000;
const contentRevision = 1;
const contentOwner = 'Kineo prototype';
const firstOrdinal = 1;
const lastMovementOrdinal = 5;
const baseMovementOrdinals = Object.freeze(
  Array.from(
    { length: lastMovementOrdinal },
    (_, index) => index + firstOrdinal,
  ),
);
const defaultFragmentMovementOrdinal = 4;
const secondaryModuleMovementOrdinal = 5;
const transitionSeconds = 15;
const quickSlotSeconds = 120;
const standardSlotSeconds = 240;
const quickFirstMovementSeconds = 60;
const quickSecondMovementSeconds = 90;
const standardFirstMovementSeconds = 120;
const standardSecondMovementSeconds = 120;
const standardThirdMovementSeconds = 75;
const primaryItemOrdinals = Object.freeze({
  firstMovement: 1,
  firstTransition: 2,
  slot: 3,
  secondTransition: 4,
  secondMovement: 5,
  thirdTransition: 6,
  thirdMovement: 7,
});
const primaryMovementOrdinals = Object.freeze({
  first: 1,
  second: 2,
  third: 3,
});

const prototypeCopy = Object.freeze({
  contentLabel: 'Prototype content',
  instructionKey: 'prototype.movement.instruction',
  instruction:
    'Prototype instruction placeholder. Production guidance is not included.',
  safetyCueKey: 'prototype.movement.safety-cue',
  safetyCue: 'Prototype safety cue placeholder.',
  mediaAccessibilityKey: 'prototype.media.accessibility-description',
  mediaAccessibility: 'Non-instructional prototype media placeholder.',
});

type MovementKind = 'base' | 'alternative';

function must<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('The compiled prototype catalog violates its own contract.');
  }
  return result.value;
}

function areaSlug(area: BodyArea): string {
  switch (area) {
    case 'neck':
      return 'neck';
    case 'upperMidBack':
      return 'upper-mid-back';
    case 'lowerBack':
      return 'lower-back';
  }
}

function catalogId(value: string): CatalogId {
  return must(parseCatalogId(value));
}

function movementId(
  area: BodyArea,
  kind: MovementKind,
  ordinal: number,
): CatalogId {
  return catalogId(
    `kineo.prototype.movement.${areaSlug(area)}.${kind}.${ordinal}.v1`,
  );
}

function primaryId(
  area: BodyArea,
  level: RoutineLevel,
  duration: DurationVariant,
): CatalogId {
  return catalogId(
    `kineo.primary.${areaSlug(area)}.${level}.${duration}.v1`,
  );
}

function moduleId(
  area: BodyArea,
  level: RoutineLevel,
  duration: DurationVariant,
): CatalogId {
  return catalogId(
    `kineo.secondary.${areaSlug(area)}.${level}.${duration}.v1`,
  );
}

function fragmentId(
  area: BodyArea,
  level: RoutineLevel,
  duration: DurationVariant,
): CatalogId {
  return catalogId(
    `kineo.fragment.${areaSlug(area)}.${level}.${duration}.default.v1`,
  );
}

function compatibilityRuleId(
  primaryArea: BodyArea,
  secondaryArea: BodyArea,
  level: RoutineLevel,
  duration: DurationVariant,
): CatalogId {
  return catalogId(
    `kineo.compat.${areaSlug(primaryArea)}.${areaSlug(secondaryArea)}.${level}.${duration}.v1`,
  );
}

function itemId(ownerId: CatalogId, ordinal: number): CatalogId {
  return catalogId(`${ownerId}.item.${ordinal}`);
}

function slotId(ownerId: CatalogId): CatalogId {
  return catalogId(`${ownerId}.slot.secondary-focus`);
}

function movementTitleKey(
  area: BodyArea,
  kind: MovementKind,
  ordinal: number,
): string {
  return `prototype.movement.${areaSlug(area)}.${kind}.${ordinal}.title`;
}

function artifactDisplayKey(
  role: 'fragment' | 'primary' | 'secondary',
  area: BodyArea,
  level: RoutineLevel,
  duration: DurationVariant,
): string {
  return `prototype.${role}.${areaSlug(area)}.${level}.${duration}.title`;
}

function ruleDisplayKey(
  primaryArea: BodyArea,
  secondaryArea: BodyArea,
  level: RoutineLevel,
  duration: DurationVariant,
): string {
  return `prototype.compat.${areaSlug(primaryArea)}.${areaSlug(secondaryArea)}.${level}.${duration}.title`;
}

function metadata(id: CatalogId, displayNameKey: string): ContentMetadata {
  return must(
    createContentMetadata({
      id,
      revision: must(parseContentRevision(contentRevision)),
      reviewStatus: 'prototypePlaceholder',
      locale: 'en-US',
      displayNameKey,
      accessibilityDescriptionKey: prototypeCopy.mediaAccessibilityKey,
      contentOwner,
      intendedBuilds: ['internal_prototype'],
    }),
  );
}

function placeholderDigest(): Sha256Digest {
  return must(parseSha256Digest(prototypeCatalogAsset.sha256));
}

function placeholderMedia() {
  return Object.freeze({
    assetId: prototypeCatalogAsset.assetId,
    kind: prototypeCatalogAsset.kind,
    localBundlePath: prototypeCatalogAsset.localBundlePath,
    accessibilityDescriptionKey: prototypeCopy.mediaAccessibilityKey,
    sha256: placeholderDigest(),
  });
}

function makeMovements(): readonly MovementDefinition[] {
  const movements: MovementDefinition[] = [];
  for (const area of bodyAreas) {
    for (const ordinal of baseMovementOrdinals) {
      const alternativeId = movementId(area, 'alternative', ordinal);
      movements.push(
        must(
          createMovementDefinition({
            metadata: metadata(
              movementId(area, 'base', ordinal),
              movementTitleKey(area, 'base', ordinal),
            ),
            supportedAreas: [area],
            supportedLevels: routineLevels,
            position: 'prototype_abstract',
            equipment: [],
            instructionKey: prototypeCopy.instructionKey,
            safetyCueKey: prototypeCopy.safetyCueKey,
            media: placeholderMedia(),
            alternatives: [
              must(
                createAlternativeReference({
                  movementId: alternativeId,
                  reasonCodes: alternativeReasons,
                  dosePolicy: { kind: 'preserve_scheduled_dose' },
                }),
              ),
            ],
          }),
        ),
        must(
          createMovementDefinition({
            metadata: metadata(
              alternativeId,
              movementTitleKey(area, 'alternative', ordinal),
            ),
            supportedAreas: [area],
            supportedLevels: routineLevels,
            position: 'prototype_abstract',
            equipment: [],
            instructionKey: prototypeCopy.instructionKey,
            safetyCueKey: prototypeCopy.safetyCueKey,
            media: placeholderMedia(),
            alternatives: [],
          }),
        ),
      );
    }
  }
  return Object.freeze(movements);
}

function movementItem(
  ownerId: CatalogId,
  itemOrdinal: number,
  movementOrdinal: number,
  area: BodyArea,
  seconds: number,
): SequenceItem {
  return must(
    createSequenceItem({
      itemId: itemId(ownerId, itemOrdinal),
      kind: 'movement',
      movementId: movementId(area, 'base', movementOrdinal),
      dose: must(
        createDose({
          kind: 'timed',
          activeSeconds: seconds,
          estimatedSeconds: seconds,
        }),
      ),
    }),
  );
}

function transitionItem(ownerId: CatalogId, ordinal: number): SequenceItem {
  return must(
    createSequenceItem({
      itemId: itemId(ownerId, ordinal),
      kind: 'transition',
      fixedSeconds: transitionSeconds,
    }),
  );
}

function slotSeconds(duration: DurationVariant): number {
  return duration === 'quick' ? quickSlotSeconds : standardSlotSeconds;
}

function nominalSeconds(duration: DurationVariant): number {
  return prototypeCatalogDurations[duration].nominalSeconds;
}

function slotItem(
  ownerId: CatalogId,
  ordinal: number,
  defaultFragmentId: CatalogId,
  duration: DurationVariant,
): SequenceItem {
  const seconds = slotSeconds(duration);
  return must(
    createSequenceItem({
      itemId: itemId(ownerId, ordinal),
      kind: 'replacement_slot',
      slot: must(
        createReplacementSlot({
          slotId: slotId(ownerId),
          kind: 'secondary_focus',
          budget: must(
            createDurationBudget({
              minimumSeconds: seconds,
              nominalSeconds: seconds,
              maximumSeconds: seconds,
            }),
          ),
          defaultFragmentId,
          allowedPositions: ['prototype_abstract'],
          allowedEquipment: [],
        }),
      ),
    }),
  );
}

function primaryItems(
  ownerId: CatalogId,
  area: BodyArea,
  defaultFragmentId: CatalogId,
  duration: DurationVariant,
): readonly SequenceItem[] {
  if (duration === 'quick') {
    return [
      movementItem(
        ownerId,
        primaryItemOrdinals.firstMovement,
        primaryMovementOrdinals.first,
        area,
        quickFirstMovementSeconds,
      ),
      transitionItem(ownerId, primaryItemOrdinals.firstTransition),
      slotItem(ownerId, primaryItemOrdinals.slot, defaultFragmentId, duration),
      transitionItem(ownerId, primaryItemOrdinals.secondTransition),
      movementItem(
        ownerId,
        primaryItemOrdinals.secondMovement,
        primaryMovementOrdinals.second,
        area,
        quickSecondMovementSeconds,
      ),
    ];
  }
  return [
    movementItem(
      ownerId,
      primaryItemOrdinals.firstMovement,
      primaryMovementOrdinals.first,
      area,
      standardFirstMovementSeconds,
    ),
    transitionItem(ownerId, primaryItemOrdinals.firstTransition),
    slotItem(ownerId, primaryItemOrdinals.slot, defaultFragmentId, duration),
    transitionItem(ownerId, primaryItemOrdinals.secondTransition),
    movementItem(
      ownerId,
      primaryItemOrdinals.secondMovement,
      primaryMovementOrdinals.second,
      area,
      standardSecondMovementSeconds,
    ),
    transitionItem(ownerId, primaryItemOrdinals.thirdTransition),
    movementItem(
      ownerId,
      primaryItemOrdinals.thirdMovement,
      primaryMovementOrdinals.third,
      area,
      standardThirdMovementSeconds,
    ),
  ];
}

function makeVariants(): Readonly<{
  fragments: readonly RoutineFragment[];
  primaryTemplates: readonly PrimaryTemplateVariant[];
  secondaryModules: readonly SecondaryModuleVariant[];
}> {
  const fragments: RoutineFragment[] = [];
  const primaryTemplates: PrimaryTemplateVariant[] = [];
  const secondaryModules: SecondaryModuleVariant[] = [];
  for (const area of bodyAreas) {
    for (const level of routineLevels) {
      for (const duration of durationVariants) {
        const currentFragmentId = fragmentId(area, level, duration);
        fragments.push(
          must(
            createRoutineFragment({
              metadata: metadata(
                currentFragmentId,
                artifactDisplayKey('fragment', area, level, duration),
              ),
              area,
              level,
              duration,
              items: [
                movementItem(
                  currentFragmentId,
                  firstOrdinal,
                  defaultFragmentMovementOrdinal,
                  area,
                  slotSeconds(duration),
                ),
              ],
            }),
          ),
        );
        const currentPrimaryId = primaryId(area, level, duration);
        primaryTemplates.push(
          must(
            createPrimaryTemplateVariant({
              metadata: metadata(
                currentPrimaryId,
                artifactDisplayKey('primary', area, level, duration),
              ),
              area,
              level,
              duration,
              nominalSeconds: nominalSeconds(duration),
              items: primaryItems(
                currentPrimaryId,
                area,
                currentFragmentId,
                duration,
              ),
            }),
          ),
        );
        const currentModuleId = moduleId(area, level, duration);
        secondaryModules.push(
          must(
            createSecondaryModuleVariant({
              metadata: metadata(
                currentModuleId,
                artifactDisplayKey('secondary', area, level, duration),
              ),
              area,
              level,
              duration,
              slotKind: 'secondary_focus',
              nominalSeconds: slotSeconds(duration),
              position: 'prototype_abstract',
              equipment: [],
              items: [
                movementItem(
                  currentModuleId,
                  firstOrdinal,
                  secondaryModuleMovementOrdinal,
                  area,
                  slotSeconds(duration),
                ),
              ],
            }),
          ),
        );
      }
    }
  }
  return Object.freeze({
    fragments: Object.freeze(fragments),
    primaryTemplates: Object.freeze(primaryTemplates),
    secondaryModules: Object.freeze(secondaryModules),
  });
}

function makeCompatibilityRules(): readonly CompatibilityRule[] {
  const rules: CompatibilityRule[] = [];
  for (const primaryArea of bodyAreas) {
    for (const secondaryArea of bodyAreas) {
      if (primaryArea === secondaryArea) {
        continue;
      }
      for (const level of routineLevels) {
        for (const duration of durationVariants) {
          const currentPrimaryId = primaryId(primaryArea, level, duration);
          rules.push(
            must(
              createCompatibilityRule({
                metadata: metadata(
                  compatibilityRuleId(
                    primaryArea,
                    secondaryArea,
                    level,
                    duration,
                  ),
                  ruleDisplayKey(
                    primaryArea,
                    secondaryArea,
                    level,
                    duration,
                  ),
                ),
                primaryArea,
                secondaryArea,
                level,
                duration,
                primaryTemplateId: currentPrimaryId,
                slotId: slotId(currentPrimaryId),
                secondaryModuleId: moduleId(
                  secondaryArea,
                  level,
                  duration,
                ),
                allowed: true,
                transitionOrderReviewed: true,
                duplicateMovementReviewed: true,
                equipmentReviewed: true,
                positionChangesReviewed: true,
                cueInteractionReviewed: true,
              }),
            ),
          );
        }
      }
    }
  }
  return Object.freeze(rules);
}

function durationPolicies(): readonly DurationPolicy[] {
  return Object.freeze(
    durationVariants.map((variant) =>
      must(
        createDurationPolicy({
          variant,
          ...prototypeCatalogDurations[variant],
        }),
      ),
    ),
  );
}

export function makePrototypeRoutineCatalog(): RoutineCatalog {
  const variants = makeVariants();
  return must(
    createSignedCatalog({
      catalogVersion: must(parseCatalogVersion(prototypeCatalogVersion)),
      createdAtMilliseconds: prototypeCreatedAtMilliseconds,
      buildEligibility: ['internal_prototype'],
      durationPolicies: durationPolicies(),
      movements: makeMovements(),
      fragments: variants.fragments,
      primaryTemplates: variants.primaryTemplates,
      secondaryModules: variants.secondaryModules,
      compatibilityRules: makeCompatibilityRules(),
    }),
  );
}

export function prototypeCatalogLocalizedStrings(): Readonly<
  Record<string, string>
> {
  const strings: Record<string, string> = {
    [prototypeCopy.mediaAccessibilityKey]: prototypeCopy.mediaAccessibility,
    [prototypeCopy.instructionKey]: prototypeCopy.instruction,
    [prototypeCopy.safetyCueKey]: prototypeCopy.safetyCue,
  };
  for (const area of bodyAreas) {
    for (const ordinal of baseMovementOrdinals) {
      strings[movementTitleKey(area, 'base', ordinal)] =
        `Prototype movement ${ordinal}`;
      strings[movementTitleKey(area, 'alternative', ordinal)] =
        `Prototype alternative ${ordinal}`;
    }
    for (const level of routineLevels) {
      for (const duration of durationVariants) {
        strings[artifactDisplayKey('fragment', area, level, duration)] =
          prototypeCopy.contentLabel;
        strings[artifactDisplayKey('primary', area, level, duration)] =
          prototypeCopy.contentLabel;
        strings[artifactDisplayKey('secondary', area, level, duration)] =
          prototypeCopy.contentLabel;
      }
    }
  }
  for (const primaryArea of bodyAreas) {
    for (const secondaryArea of bodyAreas) {
      if (primaryArea === secondaryArea) {
        continue;
      }
      for (const level of routineLevels) {
        for (const duration of durationVariants) {
          strings[
            ruleDisplayKey(primaryArea, secondaryArea, level, duration)
          ] = prototypeCopy.contentLabel;
        }
      }
    }
  }
  return Object.freeze(strings);
}

export function prototypeCatalogAssetDigests(): Readonly<
  Record<string, Sha256Digest>
> {
  return Object.freeze({
    [prototypeCatalogAsset.localBundlePath]: placeholderDigest(),
  });
}
