import { describe, expect, it } from '@jest/globals';

import { parseSelectionDecisionId } from '../domain/selection-domain';
import { prototypeSelectionRulesVersion } from '../selection/plan-selector';
import {
  parseCatalogId,
  parseSha256Digest,
  sha256DigestHexLength,
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
  type ComposedRoutine,
} from './routine-composer';
import {
  buildRoutineSessionSnapshot,
  findSnapshotAlternative,
  parseRoutineSessionId,
} from './routine-session-snapshot';

const sessionIdValue = '00000000-0000-0000-0000-000000000001';
const decisionIdValue = '00000000-0000-0000-0000-000000000002';
const compositionIdValue = '00000000-0000-0000-0000-000000000003';
const createdAtMilliseconds = 1_750_000_000_000;
const notice = 'Prototype content';
const explanationKey = 'prototype.explanation';
const parameterKey = 'area';
const parameterValue = 'neck';

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A routine-session snapshot fixture failed validation.');
  }
  return result.value;
}

function resources() {
  return {
    localizedStrings: prototypeCatalogLocalizedStrings(),
    assetDigestsByPath: prototypeCatalogAssetDigests(),
  };
}

function composition(secondaryArea: 'lowerBack' | undefined): ComposedRoutine {
  const catalog = makePrototypeRoutineCatalog();
  const request = required(
    createCatalogCompositionRequest({
      decisionId: required(parseSelectionDecisionId(decisionIdValue)),
      primaryArea: 'neck',
      secondaryArea,
      selectedLevel: 'balanced',
      duration: 'standard',
      catalogVersion: catalog.catalogVersion,
      buildChannel: 'internal_prototype',
    }),
  );
  const result = composeRoutine(
    request,
    catalog,
    resources(),
    required(parseCompositionId(compositionIdValue)),
  );
  if (result.kind !== 'composed') {
    throw new Error('Expected the prototype routine to compose.');
  }
  return result.routine;
}

function snapshotInput(secondaryArea: 'lowerBack' | undefined) {
  const catalog = makePrototypeRoutineCatalog();
  return {
    sessionId: required(parseRoutineSessionId(sessionIdValue)),
    decisionId: required(parseSelectionDecisionId(decisionIdValue)),
    composition: composition(secondaryArea),
    catalog,
    resources: resources(),
    buildChannel: 'internal_prototype',
    rulesVersion: prototypeSelectionRulesVersion,
    notices: [notice],
    explanationKeys: [explanationKey],
    explanationParameters: [{ [parameterKey]: parameterValue }],
    createdAtMilliseconds,
  } as const;
}

describe('Routine session snapshot', () => {
  it('freezes localized content, alternatives, sources, and composition identity', () => {
    const result = buildRoutineSessionSnapshot(snapshotInput('lowerBack'));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const snapshot = result.value;
    expect(snapshot).toMatchObject({
      fingerprint: snapshotInput('lowerBack').composition.fingerprint,
      compositionId: snapshotInput('lowerBack').composition.compositionId,
      includedAreas: ['neck', 'lowerBack'],
    });
    expect(snapshot.items).toHaveLength(
      snapshotInput('lowerBack').composition.orderedItems.length,
    );
    expect(
      snapshot.items.some((item) => item.sourceRole === 'secondary_module'),
    ).toBe(true);
    const movementItems = snapshot.items.filter(
      (item) => item.kind === 'movement',
    );
    expect(movementItems.length).toBeGreaterThan(0);
    for (const item of movementItems) {
      expect(item.localizedTitle).toContain('Prototype');
      expect(item.localizedInstruction.length).toBeGreaterThan(0);
      expect(item.localizedSafetyCue.length).toBeGreaterThan(0);
      expect(item.accessibleDescription.length).toBeGreaterThan(0);
      expect(item.availableAlternatives).toHaveLength(1);
      expect(item.availableAlternatives[0]?.scheduledDose).toEqual(
        item.scheduledDose,
      );
    }
  });

  it('fails when required presentation content is missing', () => {
    const input = snapshotInput(undefined);
    const movementId = input.composition.orderedItems.find(
      (item) => item.item.kind === 'movement',
    )?.item;
    if (movementId?.kind !== 'movement') {
      throw new Error('Prototype composition has no movement.');
    }
    const movement = input.catalog.movements.find(
      (candidate) => candidate.metadata.id === movementId.movementId,
    );
    if (movement === undefined) {
      throw new Error('Prototype composition movement is missing.');
    }
    const strings = { ...input.resources.localizedStrings };
    delete strings[movement.metadata.displayNameKey];

    expect(
      buildRoutineSessionSnapshot({
        ...input,
        resources: { ...input.resources, localizedStrings: strings },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: 'missingLocalization',
        key: movement.metadata.displayNameKey,
      },
    });
  });

  it('rejects misaligned explanation presentation', () => {
    const input = snapshotInput(undefined);
    expect(
      buildRoutineSessionSnapshot({
        ...input,
        explanationParameters: [],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'routineSessionSnapshot' },
    });
  });

  it('rejects a catalog whose signed content no longer validates', () => {
    const input = snapshotInput(undefined);
    const invalidFingerprint = required(
      parseSha256Digest('0'.repeat(sha256DigestHexLength)),
    );

    expect(
      buildRoutineSessionSnapshot({
        ...input,
        catalog: {
          ...input.catalog,
          manifestFingerprint: invalidFingerprint,
        },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'manifestFingerprintMismatch' },
    });
  });

  it('resolves only alternatives frozen for the selected item', () => {
    const built = buildRoutineSessionSnapshot(snapshotInput(undefined));
    if (!built.ok) {
      throw new Error('Expected a valid snapshot.');
    }
    const item = built.value.items.find(
      (candidate) =>
        candidate.kind === 'movement' &&
        candidate.availableAlternatives.length > 0,
    );
    if (item?.kind !== 'movement' || item.availableAlternatives[0] === undefined) {
      throw new Error('Expected an offered snapshot alternative.');
    }
    const offered = item.availableAlternatives[0];
    expect(
      findSnapshotAlternative(built.value, item.itemId, offered.movementId),
    ).toEqual({ ok: true, value: offered });

    const unknown = required(
      parseCatalogId('kineo.prototype.movement.unknown.v1'),
    );
    expect(
      findSnapshotAlternative(built.value, item.itemId, unknown),
    ).toEqual({
      ok: false,
      error: { code: 'alternativeNotOffered', movementId: unknown },
    });
  });
});
