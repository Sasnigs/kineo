import { describe, expect, it } from '@jest/globals';

import type { BodyArea } from '../domain/selection-domain';
import type { MovementDefinition } from './catalog-content';
import {
  createContentMetadata,
  createDurationPolicy,
  parseCatalogId,
  parseCatalogVersion,
  parseContentRevision,
  prototypeCatalogDurations,
  sha256DigestHexLength,
  type ContentMetadata,
} from './catalog-primitives';
import {
  computeManifestFingerprint,
  createSignedCatalog,
  makeCanonicalFingerprint,
} from './routine-catalog';

const createdAtMilliseconds = 1_750_000_000_000;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A routine-catalog fixture failed validation.');
  }
  return result.value;
}

function metadata(candidate: string): ContentMetadata {
  return required(
    createContentMetadata({
      id: required(parseCatalogId(candidate)),
      revision: required(parseContentRevision(1)),
      reviewStatus: 'prototypePlaceholder',
      locale: 'en-US',
      displayNameKey: 'prototype.display-name',
      accessibilityDescriptionKey: 'prototype.accessibility-description',
      contentOwner: 'Kineo prototype',
      intendedBuilds: ['internal_prototype'],
    }),
  );
}

function movement(candidate: string): MovementDefinition {
  return {
    metadata: metadata(candidate),
    supportedAreas: ['neck'],
    supportedLevels: ['gentle'],
    position: 'prototype_abstract',
    equipment: [],
    instructionKey: 'prototype.instruction',
    safetyCueKey: 'prototype.safety',
    alternatives: [],
  };
}

const quickPolicy = required(
  createDurationPolicy({
    variant: 'quick',
    ...prototypeCatalogDurations.quick,
  }),
);
const standardPolicy = required(
  createDurationPolicy({
    variant: 'standard',
    ...prototypeCatalogDurations.standard,
  }),
);

describe('Routine catalog manifest', () => {
  it('signs unordered catalog collections deterministically', () => {
    const first = movement('kineo.prototype.movement.neck.base.1.v1');
    const second = movement('kineo.prototype.movement.neck.base.2.v1');
    const common = {
      catalogVersion: required(parseCatalogVersion('1.0.0')),
      createdAtMilliseconds,
      buildEligibility: ['internal_prototype'] as const,
      fragments: [],
      primaryTemplates: [],
      secondaryModules: [],
      compatibilityRules: [],
    };

    const forward = required(
      createSignedCatalog({
        ...common,
        durationPolicies: [quickPolicy, standardPolicy],
        movements: [first, second],
      }),
    );
    const reversed = required(
      createSignedCatalog({
        ...common,
        durationPolicies: [standardPolicy, quickPolicy],
        movements: [second, first],
      }),
    );

    expect(forward.manifestFingerprint).toBe(reversed.manifestFingerprint);
    expect(required(computeManifestFingerprint(forward))).toBe(
      forward.manifestFingerprint,
    );
  });

  it('changes the fingerprint when covered content changes', () => {
    const common = {
      createdAtMilliseconds,
      buildEligibility: ['internal_prototype'] as const,
      durationPolicies: [quickPolicy, standardPolicy],
      movements: [movement('kineo.prototype.movement.neck.base.1.v1')],
      fragments: [],
      primaryTemplates: [],
      secondaryModules: [],
      compatibilityRules: [],
    };
    const original = required(
      createSignedCatalog({
        ...common,
        catalogVersion: required(parseCatalogVersion('1.0.0')),
      }),
    );
    const changed = required(
      createSignedCatalog({
        ...common,
        catalogVersion: required(parseCatalogVersion('1.0.1')),
      }),
    );

    expect(original.manifestFingerprint).not.toBe(changed.manifestFingerprint);
    expect(original.manifestFingerprint).toHaveLength(sha256DigestHexLength);
    expect(original.manifestFingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it('rejects invalid catalog envelopes', () => {
    expect(
      createSignedCatalog({
        schemaVersion: 0,
        catalogVersion: required(parseCatalogVersion('1.0.0')),
        createdAtMilliseconds,
        buildEligibility: ['internal_prototype'],
        durationPolicies: [quickPolicy],
        movements: [],
        fragments: [],
        primaryTemplates: [],
        secondaryModules: [],
        compatibilityRules: [],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'schemaVersion' },
    });
  });

  it('copies and deeply freezes caller-owned catalog content before signing', () => {
    const supportedAreas: BodyArea[] = ['neck'];
    const callerMovement = movement(
      'kineo.prototype.movement.neck.caller-owned.v1',
    );
    const catalog = required(
      createSignedCatalog({
        catalogVersion: required(parseCatalogVersion('1.0.0')),
        createdAtMilliseconds,
        buildEligibility: ['internal_prototype'],
        durationPolicies: [quickPolicy, standardPolicy],
        movements: [{ ...callerMovement, supportedAreas }],
        fragments: [],
        primaryTemplates: [],
        secondaryModules: [],
        compatibilityRules: [],
      }),
    );

    supportedAreas[0] = 'upperMidBack';

    expect(catalog.movements[0]?.supportedAreas).toEqual(['neck']);
    expect(Object.isFrozen(catalog.movements[0])).toBe(true);
    expect(Object.isFrozen(catalog.movements[0]?.metadata)).toBe(true);
    expect(Object.isFrozen(catalog.movements[0]?.supportedAreas)).toBe(true);
  });

  it('returns a typed failure for cyclic fingerprint payloads', () => {
    const cyclic: { self?: object } = {};
    cyclic.self = cyclic;

    expect(makeCanonicalFingerprint(cyclic, true)).toEqual({
      ok: false,
      error: {
        code: 'invalidArtifact',
        field: 'canonicalFingerprintPayload',
      },
    });
  });
});
