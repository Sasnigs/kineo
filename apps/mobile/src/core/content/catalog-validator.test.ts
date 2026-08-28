import { describe, expect, it } from '@jest/globals';

import type {
  CompatibilityRule,
  MovementDefinition,
  PrimaryTemplateVariant,
} from './catalog-content';
import {
  createAlternativeReference,
} from './catalog-content';
import {
  createContentMetadata,
  parseCatalogId,
  parseContentRevision,
  parseSha256Digest,
  sha256DigestHexLength,
  type CatalogId,
} from './catalog-primitives';
import {
  validateCatalog,
  type CatalogValidationResources,
} from './catalog-validator';
import {
  makePrototypeRoutineCatalog,
  prototypeCatalogAssetDigests,
  prototypeCatalogLocalizedStrings,
} from './prototype-routine-catalog';
import {
  createSignedCatalog,
  type RoutineCatalog,
  type UnsignedRoutineCatalog,
} from './routine-catalog';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A catalog-validator fixture failed validation.');
  }
  return result.value;
}

function id(candidate: string): CatalogId {
  return required(parseCatalogId(candidate));
}

function resources(): CatalogValidationResources {
  return {
    localizedStrings: prototypeCatalogLocalizedStrings(),
    assetDigestsByPath: prototypeCatalogAssetDigests(),
  };
}

function resign(
  catalog: RoutineCatalog,
  overrides: Partial<UnsignedRoutineCatalog>,
): RoutineCatalog {
  const { manifestFingerprint: _, ...unsigned } = catalog;
  return required(createSignedCatalog({ ...unsigned, ...overrides }));
}

describe('Catalog validator', () => {
  it('accepts the complete prototype catalog for internal builds', () => {
    expect(
      validateCatalog(
        makePrototypeRoutineCatalog(),
        'internal_prototype',
        resources(),
      ),
    ).toEqual({ ok: true, value: undefined });
  });

  it('fails closed when the signed manifest is tampered', () => {
    const catalog = makePrototypeRoutineCatalog();
    const tampered = {
      ...catalog,
      manifestFingerprint: required(
        parseSha256Digest('0'.repeat(sha256DigestHexLength)),
      ),
    };
    expect(
      validateCatalog(tampered, 'internal_prototype', resources()),
    ).toEqual({
      ok: false,
      error: { code: 'manifestFingerprintMismatch' },
    });
  });

  it('reports missing localization and asset evidence explicitly', () => {
    const catalog = makePrototypeRoutineCatalog();
    const missingKey = catalog.movements[0]?.instructionKey;
    const assetPath = catalog.movements[0]?.media?.localBundlePath;
    if (missingKey === undefined || assetPath === undefined) {
      throw new Error('Prototype resources are incomplete.');
    }
    const strings = { ...prototypeCatalogLocalizedStrings() };
    delete strings[missingKey];
    expect(
      validateCatalog(catalog, 'internal_prototype', {
        ...resources(),
        localizedStrings: strings,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'missingLocalization', key: missingKey },
    });
    expect(
      validateCatalog(catalog, 'internal_prototype', {
        ...resources(),
        assetDigestsByPath: {},
      }),
    ).toEqual({
      ok: false,
      error: { code: 'missingAsset', path: assetPath },
    });
  });

  it('rejects missing references and alternative cycles', () => {
    const catalog = makePrototypeRoutineCatalog();
    const removedId = id('kineo.prototype.movement.neck.base.1.v1');
    const missing = resign(catalog, {
      movements: catalog.movements.filter(
        (movement) => movement.metadata.id !== removedId,
      ),
    });
    expect(
      validateCatalog(missing, 'internal_prototype', resources()),
    ).toEqual({
      ok: false,
      error: { code: 'missingReference', id: removedId },
    });

    const baseId = removedId;
    const alternativeId = id(
      'kineo.prototype.movement.neck.alternative.1.v1',
    );
    const cycleReference = required(
      createAlternativeReference({
        movementId: baseId,
        reasonCodes: ['userPreference'],
        dosePolicy: { kind: 'preserve_scheduled_dose' },
      }),
    );
    const cyclicMovements: readonly MovementDefinition[] =
      catalog.movements.map((movement) =>
        movement.metadata.id === alternativeId
          ? Object.freeze({ ...movement, alternatives: [cycleReference] })
          : movement,
      );
    const cyclic = resign(catalog, { movements: cyclicMovements });
    expect(
      validateCatalog(cyclic, 'internal_prototype', resources()),
    ).toEqual({
      ok: false,
      error: { code: 'alternativeCycle', id: baseId },
    });
  });

  it('requires all review flags only for allowed compatibility rules', () => {
    const catalog = makePrototypeRoutineCatalog();
    const original = catalog.compatibilityRules[0];
    if (original === undefined) {
      throw new Error('Prototype compatibility rules are missing.');
    }
    const incomplete: CompatibilityRule = Object.freeze({
      ...original,
      transitionOrderReviewed: false,
    });
    const incompleteCatalog = resign(catalog, {
      compatibilityRules: catalog.compatibilityRules.map((rule) =>
        rule.metadata.id === original.metadata.id ? incomplete : rule,
      ),
    });
    expect(
      validateCatalog(incompleteCatalog, 'internal_prototype', resources()),
    ).toEqual({
      ok: false,
      error: { code: 'incompatibleContent', id: original.metadata.id },
    });

    const denied: CompatibilityRule = Object.freeze({
      ...original,
      allowed: false,
      transitionOrderReviewed: false,
      duplicateMovementReviewed: false,
      equipmentReviewed: false,
      positionChangesReviewed: false,
      cueInteractionReviewed: false,
    });
    const deniedCatalog = resign(catalog, {
      compatibilityRules: catalog.compatibilityRules.map((rule) =>
        rule.metadata.id === original.metadata.id ? denied : rule,
      ),
    });
    expect(
      validateCatalog(deniedCatalog, 'internal_prototype', resources()),
    ).toEqual({ ok: true, value: undefined });
  });

  it('rejects duplicate eligible variants instead of using array order', () => {
    const catalog = makePrototypeRoutineCatalog();
    const original = catalog.primaryTemplates[0];
    if (original === undefined) {
      throw new Error('Prototype primary templates are missing.');
    }
    const duplicateMetadata = required(
      createContentMetadata({
        ...original.metadata,
        id: id('kineo.primary.duplicate.gentle.quick.v1'),
        revision: required(parseContentRevision(1)),
      }),
    );
    const duplicate: PrimaryTemplateVariant = Object.freeze({
      ...original,
      metadata: duplicateMetadata,
    });
    const mutated = resign(catalog, {
      primaryTemplates: [...catalog.primaryTemplates, duplicate],
    });
    const key = `primary_template:${original.area}:${original.level}:${original.duration}`;
    expect(
      validateCatalog(mutated, 'internal_prototype', resources()),
    ).toEqual({
      ok: false,
      error: { code: 'duplicateVariant', key },
    });
  });

  it('rejects mismatched asset bytes and every public prototype build', () => {
    const catalog = makePrototypeRoutineCatalog();
    const assetPath = catalog.movements[0]?.media?.localBundlePath;
    if (assetPath === undefined) {
      throw new Error('Prototype media is missing.');
    }
    expect(
      validateCatalog(catalog, 'internal_prototype', {
        ...resources(),
        assetDigestsByPath: {
          [assetPath]: required(
            parseSha256Digest('0'.repeat(sha256DigestHexLength)),
          ),
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'assetFingerprintMismatch', path: assetPath },
    });
    expect(validateCatalog(catalog, 'public_release', resources())).toEqual({
      ok: false,
      error: { code: 'ineligibleCatalog', channel: 'public_release' },
    });
  });
});
