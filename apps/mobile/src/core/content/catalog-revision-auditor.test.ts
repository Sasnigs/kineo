import { describe, expect, it } from '@jest/globals';

import type { MovementDefinition } from './catalog-content';
import {
  createContentMetadata,
  parseCatalogVersion,
  parseContentRevision,
} from './catalog-primitives';
import { auditCatalogReplacement } from './catalog-revision-auditor';
import { makePrototypeRoutineCatalog } from './prototype-routine-catalog';
import {
  createSignedCatalog,
  type RoutineCatalog,
} from './routine-catalog';

const revisionIncrement = 1;
const timestampIncrementMilliseconds = 1;

function required<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('A revision-auditor fixture failed validation.');
  }
  return result.value;
}

function candidate(
  installed: RoutineCatalog,
  version: string,
  movements: readonly MovementDefinition[],
  createdAtMilliseconds = installed.createdAtMilliseconds,
): RoutineCatalog {
  const { manifestFingerprint: _, ...unsigned } = installed;
  return required(
    createSignedCatalog({
      ...unsigned,
      catalogVersion: required(parseCatalogVersion(version)),
      createdAtMilliseconds,
      movements,
    }),
  );
}

describe('Catalog revision auditor', () => {
  it('accepts unchanged catalogs and changed records with incremented revisions', () => {
    const installed = makePrototypeRoutineCatalog();
    expect(auditCatalogReplacement(installed, installed)).toEqual({
      ok: true,
      value: undefined,
    });
    const original = installed.movements[0];
    if (original === undefined) {
      throw new Error('Prototype movement is missing.');
    }
    const changed: MovementDefinition = {
      ...original,
      metadata: required(
        createContentMetadata({
          ...original.metadata,
          revision: required(
            parseContentRevision(
              original.metadata.revision + revisionIncrement,
            ),
          ),
        }),
      ),
      position: 'adaptable',
    };
    const replacement = candidate(
      installed,
      '0.1.1',
      installed.movements.map((movement) =>
        movement.metadata.id === original.metadata.id ? changed : movement,
      ),
    );
    expect(auditCatalogReplacement(replacement, installed)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('rejects silent content edits and reused catalog versions', () => {
    const installed = makePrototypeRoutineCatalog();
    const original = installed.movements[0];
    if (original === undefined) {
      throw new Error('Prototype movement is missing.');
    }
    const silentlyChanged: MovementDefinition = {
      ...original,
      position: 'adaptable',
    };
    const silentCandidate = candidate(
      installed,
      '0.1.1',
      installed.movements.map((movement) =>
        movement.metadata.id === original.metadata.id
          ? silentlyChanged
          : movement,
      ),
    );
    expect(auditCatalogReplacement(silentCandidate, installed)).toEqual({
      ok: false,
      error: {
        code: 'contentChangedWithoutRevision',
        id: original.metadata.id,
        revision: original.metadata.revision,
      },
    });

    const reusedVersion = candidate(
      installed,
      installed.catalogVersion,
      installed.movements,
      installed.createdAtMilliseconds + timestampIncrementMilliseconds,
    );
    expect(auditCatalogReplacement(reusedVersion, installed)).toEqual({
      ok: false,
      error: {
        code: 'catalogVersionReused',
        version: installed.catalogVersion,
      },
    });
  });
});
