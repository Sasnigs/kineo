import { describe, expect, it } from '@jest/globals';

import type { BodyArea, DurationVariant, RoutineLevel } from '../domain/selection-domain';
import {
  createCompatibilityRule,
  createDurationBudget,
  createMovementDefinition,
  createPrimaryTemplateVariant,
  createReplacementSlot,
  createRoutineFragment,
  createSecondaryModuleVariant,
  createSequenceItem,
  hasCompleteMechanicalReview,
  type SequenceItem,
} from './catalog-content';
import {
  createContentMetadata,
  createDose,
  parseCatalogId,
  parseContentRevision,
  prototypeCatalogDurations,
  type CatalogId,
  type ContentMetadata,
  type Dose,
} from './catalog-primitives';

const movementSeconds = 60;
const slotSeconds = 120;
const validRevision = 1;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A catalog test fixture failed validation.');
  }
  return result.value;
}

function id(candidate: string): CatalogId {
  return required(parseCatalogId(candidate));
}

function metadata(candidate: string): ContentMetadata {
  return required(
    createContentMetadata({
      id: id(candidate),
      revision: required(parseContentRevision(validRevision)),
      reviewStatus: 'prototypePlaceholder',
      locale: 'en-US',
      displayNameKey: 'prototype.display-name',
      accessibilityDescriptionKey: 'prototype.accessibility-description',
      contentOwner: 'Kineo prototype',
      intendedBuilds: ['internal_prototype'],
    }),
  );
}

function dose(): Dose {
  return required(
    createDose({
      kind: 'timed',
      activeSeconds: movementSeconds,
      estimatedSeconds: movementSeconds,
    }),
  );
}

function movementItem(owner = 'owner'): SequenceItem {
  return required(
    createSequenceItem({
      itemId: id(`${owner}.item.movement`),
      kind: 'movement',
      movementId: id('kineo.prototype.movement.neck.base.1.v1'),
      dose: dose(),
    }),
  );
}

function replacementItem(owner = 'owner'): SequenceItem {
  return required(
    createSequenceItem({
      itemId: id(`${owner}.item.slot`),
      kind: 'replacement_slot',
      slot: required(
        createReplacementSlot({
          slotId: id(`${owner}.slot.secondary-focus`),
          kind: 'secondary_focus',
          budget: required(
            createDurationBudget({
              minimumSeconds: slotSeconds,
              nominalSeconds: slotSeconds,
              maximumSeconds: slotSeconds,
            }),
          ),
          defaultFragmentId: id('kineo.fragment.neck.gentle.quick.default.v1'),
          allowedPositions: ['prototype_abstract'],
          allowedEquipment: [],
        }),
      ),
    }),
  );
}

describe('Catalog content graph', () => {
  it('accepts only fields required by each sequence item kind', () => {
    expect(movementItem().kind).toBe('movement');
    expect(
      createSequenceItem({
        itemId: id('owner.item.transition'),
        kind: 'transition',
        fixedSeconds: movementSeconds,
      }).ok,
    ).toBe(true);
    expect(replacementItem().kind).toBe('replacement_slot');

    expect(
      createSequenceItem({
        itemId: id('owner.item.invalid-movement'),
        kind: 'movement',
        fixedSeconds: movementSeconds,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidSequenceItem', field: 'movement' },
    });
    expect(
      createSequenceItem({
        itemId: id('owner.item.invalid-transition'),
        kind: 'transition',
        fixedSeconds: 0,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidSequenceItem', field: 'transition' },
    });
  });

  it('rejects slots in fragments and modules while requiring one in primaries', () => {
    expect(
      createRoutineFragment({
        metadata: metadata('kineo.fragment.valid.quick.v1'),
        area: 'neck',
        level: 'gentle',
        duration: 'quick',
        items: [movementItem()],
      }).ok,
    ).toBe(true);
    expect(
      createRoutineFragment({
        metadata: metadata('kineo.fragment.invalid.quick.v1'),
        area: 'neck',
        level: 'gentle',
        duration: 'quick',
        items: [replacementItem()],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'slotCount' },
    });
    expect(
      createPrimaryTemplateVariant({
        metadata: metadata('kineo.primary.invalid.quick.v1'),
        area: 'neck',
        level: 'gentle',
        duration: 'quick',
        nominalSeconds: prototypeCatalogDurations.quick.nominalSeconds,
        items: [movementItem()],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'slotCount' },
    });
    expect(
      createSecondaryModuleVariant({
        metadata: metadata('kineo.secondary.invalid.quick.v1'),
        area: 'lowerBack',
        level: 'gentle',
        duration: 'quick',
        slotKind: 'secondary_focus',
        nominalSeconds: slotSeconds,
        position: 'prototype_abstract',
        equipment: [],
        items: [replacementItem()],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'slotCount' },
    });
  });

  it('rejects duplicate item identifiers and empty movement support', () => {
    const movement = movementItem();
    expect(
      createRoutineFragment({
        metadata: metadata('kineo.fragment.duplicate.quick.v1'),
        area: 'neck',
        level: 'gentle',
        duration: 'quick',
        items: [movement, movement],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'duplicateItemID' },
    });
    expect(
      createMovementDefinition({
        metadata: metadata('kineo.prototype.movement.neck.base.1.v1'),
        supportedAreas: [],
        supportedLevels: ['gentle'],
        position: 'prototype_abstract',
        equipment: [],
        instructionKey: 'prototype.instruction',
        safetyCueKey: 'prototype.safety',
        alternatives: [],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'supportedAreas' },
    });
  });

  it('requires distinct compatibility areas and reports complete review', () => {
    const ruleInput = {
      metadata: metadata('kineo.compat.neck.lower-back.gentle.quick.v1'),
      primaryArea: 'neck' as BodyArea,
      secondaryArea: 'lowerBack' as BodyArea,
      level: 'gentle' as RoutineLevel,
      duration: 'quick' as DurationVariant,
      primaryTemplateId: id('kineo.primary.neck.gentle.quick.v1'),
      slotId: id('kineo.primary.neck.gentle.quick.v1.slot.secondary-focus'),
      secondaryModuleId: id('kineo.secondary.lower-back.gentle.quick.v1'),
      allowed: true,
      transitionOrderReviewed: true,
      duplicateMovementReviewed: true,
      equipmentReviewed: true,
      positionChangesReviewed: true,
      cueInteractionReviewed: true,
    };
    const rule = createCompatibilityRule(ruleInput);
    expect(rule.ok).toBe(true);
    if (rule.ok) {
      expect(hasCompleteMechanicalReview(rule.value)).toBe(true);
    }
    expect(
      createCompatibilityRule({
        ...ruleInput,
        secondaryArea: 'neck',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidArtifact', field: 'compatibilityAreas' },
    });
  });
});
