import { describe, expect, it } from '@jest/globals';

import { bodyAreas, durationVariants, routineLevels } from '../domain/selection-domain';
import type { SequenceItem } from './catalog-content';
import {
  makePrototypeRoutineCatalog,
  prototypeCatalogCounts,
  prototypeCatalogLocalizedStrings,
} from './prototype-routine-catalog';

function itemSeconds(item: SequenceItem): number {
  switch (item.kind) {
    case 'movement':
      return item.dose.estimatedSeconds;
    case 'transition':
    case 'rest':
      return item.fixedSeconds;
    case 'replacement_slot':
      return 0;
  }
}

describe('Prototype routine catalog', () => {
  it('has exact cardinalities and globally unique record identifiers', () => {
    const catalog = makePrototypeRoutineCatalog();
    const recordIds = [
      ...catalog.movements,
      ...catalog.fragments,
      ...catalog.primaryTemplates,
      ...catalog.secondaryModules,
      ...catalog.compatibilityRules,
    ].map((record) => record.metadata.id);

    expect(catalog.movements).toHaveLength(prototypeCatalogCounts.movements);
    expect(catalog.fragments).toHaveLength(prototypeCatalogCounts.fragments);
    expect(catalog.primaryTemplates).toHaveLength(
      prototypeCatalogCounts.primaryTemplates,
    );
    expect(catalog.secondaryModules).toHaveLength(
      prototypeCatalogCounts.secondaryModules,
    );
    expect(catalog.compatibilityRules).toHaveLength(
      prototypeCatalogCounts.compatibilityRules,
    );
    expect(new Set(recordIds)).toHaveProperty('size', recordIds.length);
  });

  it('contains exactly one artifact for every area-level-duration variant', () => {
    const catalog = makePrototypeRoutineCatalog();
    for (const area of bodyAreas) {
      for (const level of routineLevels) {
        for (const duration of durationVariants) {
          const matches = <Value extends { area: string; level: string; duration: string }>(
            records: readonly Value[],
          ) =>
            records.filter(
              (record) =>
                record.area === area &&
                record.level === level &&
                record.duration === duration,
            );
          expect(matches(catalog.fragments)).toHaveLength(1);
          expect(matches(catalog.primaryTemplates)).toHaveLength(1);
          expect(matches(catalog.secondaryModules)).toHaveLength(1);
        }
      }
    }
  });

  it('contains one fully reviewed rule for every ordered distinct-area pair', () => {
    const catalog = makePrototypeRoutineCatalog();
    for (const primaryArea of bodyAreas) {
      for (const secondaryArea of bodyAreas) {
        for (const level of routineLevels) {
          for (const duration of durationVariants) {
            const rules = catalog.compatibilityRules.filter(
              (rule) =>
                rule.primaryArea === primaryArea &&
                rule.secondaryArea === secondaryArea &&
                rule.level === level &&
                rule.duration === duration,
            );
            if (primaryArea === secondaryArea) {
              expect(rules).toHaveLength(0);
            } else {
              expect(rules).toHaveLength(1);
              expect(rules[0]).toMatchObject({
                allowed: true,
                transitionOrderReviewed: true,
                duplicateMovementReviewed: true,
                equipmentReviewed: true,
                positionChangesReviewed: true,
                cueInteractionReviewed: true,
              });
            }
          }
        }
      }
    }
  });

  it('uses exact authored timing and visibly labelled prototype strings', () => {
    const catalog = makePrototypeRoutineCatalog();
    const fragmentsById = new Map(
      catalog.fragments.map((fragment) => [fragment.metadata.id, fragment]),
    );
    for (const primary of catalog.primaryTemplates) {
      const seconds = primary.items.reduce((total, item) => {
        if (item.kind !== 'replacement_slot') {
          return total + itemSeconds(item);
        }
        const fragment = fragmentsById.get(item.slot.defaultFragmentId);
        if (fragment === undefined) {
          throw new Error('Prototype slot references a missing fragment.');
        }
        return (
          total +
          fragment.items.reduce(
            (fragmentTotal, fragmentItem) =>
              fragmentTotal + itemSeconds(fragmentItem),
            0,
          )
        );
      }, 0);
      expect(seconds).toBe(primary.nominalSeconds);
    }

    const strings = prototypeCatalogLocalizedStrings();
    for (const movement of catalog.movements) {
      expect(strings[movement.metadata.displayNameKey]).toContain('Prototype');
    }
  });
});
