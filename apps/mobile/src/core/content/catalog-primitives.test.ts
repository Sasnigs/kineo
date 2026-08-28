import { describe, expect, it } from '@jest/globals';

import {
  createContentMetadata,
  createDose,
  createDurationPolicy,
  isContentEligible,
  parseCatalogId,
  parseCatalogVersion,
  parseContentRevision,
  parseSha256Digest,
  prototypeCatalogDurations,
  sha256DigestHexLength,
} from './catalog-primitives';

function value<Value>(result: { ok: true; value: Value } | { ok: false }): Value {
  if (!result.ok) {
    throw new Error('Expected a valid catalog test fixture.');
  }
  return result.value;
}

describe('Catalog primitives', () => {
  it('accepts only lowercase namespaced catalog identifiers', () => {
    const valid = [
      'kineo.primary.neck.gentle.quick.v1',
      'kineo.primary.upper-mid-back.active.standard.v1',
      'owner.item.1',
    ];
    const invalid = [
      '',
      'single',
      'Kineo.primary.neck',
      'kineo..neck',
      '.kineo.neck',
      'kineo.neck-',
      'kineo.neck_focus',
    ];

    for (const candidate of valid) {
      expect(parseCatalogId(candidate).ok).toBe(true);
    }
    for (const candidate of invalid) {
      expect(parseCatalogId(candidate)).toEqual({
        ok: false,
        error: { code: 'invalidIdentifier', value: candidate },
      });
    }
  });

  it('accepts only three-component semantic catalog versions', () => {
    expect(parseCatalogVersion('1.2.3').ok).toBe(true);
    for (const candidate of ['1', '1.2', '1.02.3', '1.a.3', '1.2.3.4']) {
      expect(parseCatalogVersion(candidate)).toEqual({
        ok: false,
        error: { code: 'invalidCatalogVersion', value: candidate },
      });
    }
  });

  it('requires positive safe content revisions', () => {
    expect(parseContentRevision(1).ok).toBe(true);
    for (const candidate of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseContentRevision(candidate)).toEqual({
        ok: false,
        error: { code: 'invalidRevision' },
      });
    }
  });

  it('accepts only lowercase SHA-256 digests', () => {
    expect(parseSha256Digest('a'.repeat(sha256DigestHexLength)).ok).toBe(true);
    expect(parseSha256Digest('A'.repeat(sha256DigestHexLength)).ok).toBe(false);
    expect(
      parseSha256Digest('a'.repeat(sha256DigestHexLength - 1)).ok,
    ).toBe(false);
  });

  it('requires positive ordered duration bounds', () => {
    const quick = createDurationPolicy({
      variant: 'quick',
      nominalSeconds: prototypeCatalogDurations.quick.nominalSeconds,
      minimumSeconds: prototypeCatalogDurations.quick.minimumSeconds,
      maximumSeconds: prototypeCatalogDurations.quick.maximumSeconds,
    });
    expect(quick.ok).toBe(true);

    expect(
      createDurationPolicy({
        variant: 'quick',
        nominalSeconds: prototypeCatalogDurations.quick.nominalSeconds,
        minimumSeconds: prototypeCatalogDurations.quick.maximumSeconds,
        maximumSeconds: prototypeCatalogDurations.quick.minimumSeconds,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidDuration', field: 'quick' },
    });
  });

  it('requires dose fields to match their kind', () => {
    const timedSeconds = 60;
    const repetitionCount = 8;
    const repetitionEstimateSeconds = 45;

    expect(
      createDose({
        kind: 'timed',
        activeSeconds: timedSeconds,
        estimatedSeconds: timedSeconds,
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'timed',
        activeSeconds: timedSeconds,
        estimatedSeconds: timedSeconds,
      },
    });
    expect(
      createDose({
        kind: 'repetitions',
        repetitionCount,
        estimatedSeconds: repetitionEstimateSeconds,
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'repetitions',
        repetitionCount,
        estimatedSeconds: repetitionEstimateSeconds,
      },
    });
    expect(
      createDose({
        kind: 'timed',
        repetitionCount,
        estimatedSeconds: timedSeconds,
      }),
    ).toEqual({ ok: false, error: { code: 'invalidDose' } });
    expect(
      createDose({
        kind: 'repetitions',
        repetitionCount: 0,
        estimatedSeconds: repetitionEstimateSeconds,
      }),
    ).toEqual({ ok: false, error: { code: 'invalidDose' } });
  });

  it('enforces review evidence and prototype build boundaries', () => {
    const prototype = createContentMetadata({
      id: value(parseCatalogId('kineo.test.prototype.v1')),
      revision: value(parseContentRevision(1)),
      reviewStatus: 'prototypePlaceholder',
      locale: 'en-US',
      displayNameKey: 'prototype.display-name',
      contentOwner: 'Kineo prototype',
      intendedBuilds: ['internal_prototype'],
    });
    const approved = createContentMetadata({
      id: value(parseCatalogId('kineo.test.approved.v1')),
      revision: value(parseContentRevision(1)),
      reviewStatus: 'approvedForRelease',
      locale: 'en-US',
      displayNameKey: 'approved.display-name',
      contentOwner: 'Kineo',
      reviewedBy: 'Reviewer',
      reviewedAtMilliseconds: 1,
      reviewEvidenceId: 'evidence',
      intendedBuilds: ['internal_prototype', 'public_release'],
    });

    expect(prototype.ok).toBe(true);
    expect(approved.ok).toBe(true);
    if (prototype.ok && approved.ok) {
      expect(isContentEligible(prototype.value, 'internal_prototype')).toBe(true);
      expect(isContentEligible(prototype.value, 'public_release')).toBe(false);
      expect(isContentEligible(approved.value, 'internal_prototype')).toBe(true);
      expect(isContentEligible(approved.value, 'public_release')).toBe(true);
    }

    expect(
      createContentMetadata({
        id: value(parseCatalogId('kineo.test.invalid.v1')),
        revision: value(parseContentRevision(1)),
        reviewStatus: 'prototypePlaceholder',
        locale: 'en-US',
        displayNameKey: 'prototype.display-name',
        contentOwner: 'Kineo prototype',
        reviewedBy: 'Reviewer',
        intendedBuilds: ['internal_prototype'],
      }),
    ).toEqual({
      ok: false,
      error: { code: 'invalidMetadata', field: 'prototypeReview' },
    });
  });
});
