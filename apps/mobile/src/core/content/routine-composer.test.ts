import { describe, expect, it } from '@jest/globals';

import parityFixture from '../../../../../Packages/KineoModules/Tests/KineoCoreTests/Fixtures/catalog-composition-parity-v1.json';
import {
  bodyAreas,
  durationVariants,
  parseSelectionDecisionId,
  routineLevels,
  type BodyArea,
  type DurationVariant,
  type RoutineLevel,
} from '../domain/selection-domain';
import type {
  CompatibilityRule,
  PrimaryTemplateVariant,
  SecondaryModuleVariant,
} from './catalog-content';
import {
  createContentMetadata,
  createDose,
  parseCatalogId,
  parseCatalogVersion,
  prototypeCatalogDurations,
} from './catalog-primitives';
import {
  makePrototypeRoutineCatalog,
  prototypeCatalogAssetDigests,
  prototypeCatalogLocalizedStrings,
} from './prototype-routine-catalog';
import {
  composeRoutine,
  createCatalogCompositionRequest,
  parseCompositionId,
  type CatalogCompositionRequest,
  type ComposedRoutine,
} from './routine-composer';
import {
  createSignedCatalog,
  type RoutineCatalog,
  type UnsignedRoutineCatalog,
} from './routine-catalog';

const decisionIdValue = '00000000-0000-0000-0000-000000000001';
const firstCompositionIdValue = '00000000-0000-0000-0000-000000000002';
const secondCompositionIdValue = '00000000-0000-0000-0000-000000000003';
const budgetOverflowSeconds = 1;
const unapprovedEquipment = 'prototype-band';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A routine-composer fixture failed validation.');
  }
  return result.value;
}

function resources() {
  return {
    localizedStrings: prototypeCatalogLocalizedStrings(),
    assetDigestsByPath: prototypeCatalogAssetDigests(),
  };
}

function request(
  catalog: RoutineCatalog,
  primaryArea: BodyArea,
  secondaryArea: BodyArea | undefined,
  selectedLevel: RoutineLevel,
  duration: DurationVariant,
): CatalogCompositionRequest {
  return required(
    createCatalogCompositionRequest({
      decisionId: required(parseSelectionDecisionId(decisionIdValue)),
      primaryArea,
      secondaryArea,
      selectedLevel,
      duration,
      catalogVersion: catalog.catalogVersion,
      buildChannel: 'internal_prototype',
    }),
  );
}

function composed(
  catalog: RoutineCatalog,
  compositionRequest: CatalogCompositionRequest,
  compositionIdValue = firstCompositionIdValue,
): ComposedRoutine {
  const result = composeRoutine(
    compositionRequest,
    catalog,
    resources(),
    required(parseCompositionId(compositionIdValue)),
  );
  expect(result.kind).toBe('composed');
  if (result.kind !== 'composed') {
    throw new Error(`Expected a routine, received ${result.reason}.`);
  }
  return result.routine;
}

function resign(
  catalog: RoutineCatalog,
  overrides: Partial<UnsignedRoutineCatalog>,
): RoutineCatalog {
  const { manifestFingerprint: _, ...unsigned } = catalog;
  return required(createSignedCatalog({ ...unsigned, ...overrides }));
}

describe('Routine composer', () => {
  it('composes all 18 single-area variants exactly and deterministically', () => {
    const catalog = makePrototypeRoutineCatalog();
    for (const area of bodyAreas) {
      for (const level of routineLevels) {
        for (const duration of durationVariants) {
          const compositionRequest = request(
            catalog,
            area,
            undefined,
            level,
            duration,
          );
          const first = composed(catalog, compositionRequest);
          const second = composed(
            catalog,
            compositionRequest,
            secondCompositionIdValue,
          );
          if (
            area === parityFixture.singleArea.primaryArea &&
            level === parityFixture.singleArea.level &&
            duration === parityFixture.singleArea.duration
          ) {
            expect(first.status).toBe(parityFixture.singleArea.status);
            expect(first.nominalSeconds).toBe(
              parityFixture.singleArea.nominalSeconds,
            );
            expect(first.fingerprint).toBe(parityFixture.singleArea.fingerprint);
          }
          expect(first).toMatchObject({
            status: 'exact',
            selectedLevel: level,
            deliveredLevel: level,
            duration,
            includedAreas: [area],
            nominalSeconds: prototypeCatalogDurations[duration].nominalSeconds,
          });
          expect(first.omittedArea).toBeUndefined();
          expect(first.orderedItems).toEqual(second.orderedItems);
          expect(first.fingerprint).toBe(second.fingerprint);
          expect(first.compositionId).not.toBe(second.compositionId);
        }
      }
    }
  });

  it('composes all 36 ordered two-area variants by replacing one slot', () => {
    const catalog = makePrototypeRoutineCatalog();
    for (const primaryArea of bodyAreas) {
      for (const secondaryArea of bodyAreas) {
        if (primaryArea === secondaryArea) {
          continue;
        }
        for (const level of routineLevels) {
          for (const duration of durationVariants) {
            const routine = composed(
              catalog,
              request(
                catalog,
                primaryArea,
                secondaryArea,
                level,
                duration,
              ),
            );
            expect(routine).toMatchObject({
              status: 'exact',
              includedAreas: [primaryArea, secondaryArea],
              nominalSeconds:
                prototypeCatalogDurations[duration].nominalSeconds,
            });
            expect(routine.secondaryModule).toBeDefined();
            expect(routine.compatibilityRule).toBeDefined();
            expect(
              routine.orderedItems.filter(
                (item) =>
                  item.sourceRole === 'secondary_module' &&
                  item.sourceArea === secondaryArea,
              ),
            ).toHaveLength(1);
          }
        }
      }
    }
  });

  it('falls back to the exact primary for missing, denied, or invalid secondary content', () => {
    const catalog = makePrototypeRoutineCatalog();
    const compositionRequest = request(
      catalog,
      'neck',
      'lowerBack',
      'balanced',
      'quick',
    );
    const matchingModule = catalog.secondaryModules.find(
      (module) =>
        module.area === 'lowerBack' &&
        module.level === 'balanced' &&
        module.duration === 'quick',
    );
    const matchingRule = catalog.compatibilityRules.find(
      (rule) =>
        rule.primaryArea === 'neck' &&
        rule.secondaryArea === 'lowerBack' &&
        rule.level === 'balanced' &&
        rule.duration === 'quick',
    );
    if (matchingModule === undefined || matchingRule === undefined) {
      throw new Error('Prototype fallback fixtures are missing.');
    }

    const withoutModule = resign(catalog, {
      secondaryModules: catalog.secondaryModules.filter(
        (module) => module.metadata.id !== matchingModule.metadata.id,
      ),
    });
    expect(composed(withoutModule, compositionRequest)).toMatchObject({
      status: 'primary_only',
      omittedArea: 'lowerBack',
      omissionReason: 'contentUnavailable',
    });

    const withoutRule = resign(catalog, {
      compatibilityRules: catalog.compatibilityRules.filter(
        (rule) => rule.metadata.id !== matchingRule.metadata.id,
      ),
    });
    expect(composed(withoutRule, compositionRequest)).toMatchObject({
      status: 'primary_only',
      omissionReason: 'catalogIncompatible',
    });

    const deniedRule: CompatibilityRule = {
      ...matchingRule,
      allowed: false,
    };
    const denied = resign(catalog, {
      compatibilityRules: catalog.compatibilityRules.map((rule) =>
        rule.metadata.id === matchingRule.metadata.id ? deniedRule : rule,
      ),
    });
    expect(composed(denied, compositionRequest)).toMatchObject({
      status: 'primary_only',
      omissionReason: 'catalogIncompatible',
    });

    const incompatibleModule: SecondaryModuleVariant = {
      ...matchingModule,
      equipment: [unapprovedEquipment],
    };
    const incompatible = resign(catalog, {
      secondaryModules: catalog.secondaryModules.map((module) =>
        module.metadata.id === matchingModule.metadata.id
          ? incompatibleModule
          : module,
      ),
    });
    expect(composed(incompatible, compositionRequest)).toMatchObject({
      status: 'primary_only',
      omissionReason: 'catalogIncompatible',
    });
  });

  it('uses only gentler levels and never substitutes a duration', () => {
    const catalog = makePrototypeRoutineCatalog();
    const withoutActive = resign(catalog, {
      primaryTemplates: catalog.primaryTemplates.filter(
        (primary) =>
          !(
            primary.area === 'neck' &&
            primary.level === 'active' &&
            primary.duration === 'quick'
          ),
      ),
    });
    expect(
      composed(
        withoutActive,
        request(withoutActive, 'neck', undefined, 'active', 'quick'),
      ),
    ).toMatchObject({
      status: 'gentler_fallback',
      selectedLevel: 'active',
      deliveredLevel: 'balanced',
    });

    const withoutQuick = resign(catalog, {
      primaryTemplates: catalog.primaryTemplates.filter(
        (primary) => !(primary.area === 'neck' && primary.duration === 'quick'),
      ),
    });
    expect(
      composeRoutine(
        request(withoutQuick, 'neck', undefined, 'active', 'quick'),
        withoutQuick,
        resources(),
        required(parseCompositionId(firstCompositionIdValue)),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'no_approved_primary_content' });
  });

  it('returns precise version, catalog, and input failures', () => {
    const catalog = makePrototypeRoutineCatalog();
    expect(
      createCatalogCompositionRequest({
        decisionId: required(parseSelectionDecisionId(decisionIdValue)),
        primaryArea: 'neck',
        secondaryArea: 'neck',
        selectedLevel: 'gentle',
        duration: 'quick',
        catalogVersion: catalog.catalogVersion,
        buildChannel: 'internal_prototype',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidCompositionRequest', field: 'duplicateArea' },
    });

    const mismatchedRequest = request(
      catalog,
      'neck',
      undefined,
      'gentle',
      'quick',
    );
    const alteredVersion = resign(catalog, {
      catalogVersion: required(parseCatalogVersion('9.9.9')),
    });
    expect(
      composeRoutine(
        mismatchedRequest,
        alteredVersion,
        resources(),
        required(parseCompositionId(firstCompositionIdValue)),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'catalog_version_mismatch' });

    const original = catalog.primaryTemplates[0];
    if (original === undefined) {
      throw new Error('Prototype primary fixtures are missing.');
    }
    const duplicateMetadata = required(
      createContentMetadata({
        ...original.metadata,
        id: required(parseCatalogId('kineo.primary.duplicate.gentle.quick.v1')),
      }),
    );
    const duplicate: PrimaryTemplateVariant = {
      ...original,
      metadata: duplicateMetadata,
    };
    const ambiguous = resign(catalog, {
      primaryTemplates: [...catalog.primaryTemplates, duplicate],
    });
    expect(
      composeRoutine(
        request(
          ambiguous,
          original.area,
          undefined,
          original.level,
          original.duration,
        ),
        ambiguous,
        resources(),
        required(parseCompositionId(firstCompositionIdValue)),
      ),
    ).toEqual({ kind: 'unavailable', reason: 'invalid_catalog' });
  });

  it('keeps an over-budget module out of the composed routine', () => {
    const catalog = makePrototypeRoutineCatalog();
    const module = catalog.secondaryModules.find(
      (candidate) =>
        candidate.area === 'lowerBack' &&
        candidate.level === 'gentle' &&
        candidate.duration === 'quick',
    );
    if (module === undefined || module.items[0]?.kind !== 'movement') {
      throw new Error('Prototype module fixture is missing.');
    }
    const overBudgetSeconds = module.nominalSeconds + budgetOverflowSeconds;
    const overBudgetModule: SecondaryModuleVariant = {
      ...module,
      nominalSeconds: overBudgetSeconds,
      items: [
        {
          ...module.items[0],
          dose: required(
            createDose({
              kind: 'timed',
              activeSeconds: overBudgetSeconds,
              estimatedSeconds: overBudgetSeconds,
            }),
          ),
        },
      ],
    };
    const mutated = resign(catalog, {
      secondaryModules: catalog.secondaryModules.map((candidate) =>
        candidate.metadata.id === module.metadata.id
          ? overBudgetModule
          : candidate,
      ),
    });
    expect(
      composed(
        mutated,
        request(mutated, 'neck', 'lowerBack', 'gentle', 'quick'),
      ),
    ).toMatchObject({
      status: 'primary_only',
      omissionReason: 'catalogIncompatible',
    });
  });
});
