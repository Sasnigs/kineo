import type { Result } from '../shared/result';
import type {
  CatalogId,
  CatalogVersion,
  ContentMetadata,
  ContentRevision,
  Sha256Digest,
} from './catalog-primitives';
import {
  makeCanonicalFingerprint,
  type RoutineCatalog,
} from './routine-catalog';

export type CatalogRevisionAuditError =
  | Readonly<{ code: 'catalogVersionReused'; version: CatalogVersion }>
  | Readonly<{ code: 'revisionRegressed'; id: CatalogId }>
  | Readonly<{
      code: 'contentChangedWithoutRevision';
      id: CatalogId;
      revision: ContentRevision;
    }>
  | Readonly<{ code: 'duplicateRecordId'; id: CatalogId }>
  | Readonly<{ code: 'fingerprintFailed' }>;

type CatalogRecord = Readonly<{ metadata: ContentMetadata }>;
type RecordSnapshot = Readonly<{
  revision: ContentRevision;
  fingerprint: Sha256Digest;
}>;

function recordSnapshots(
  catalog: RoutineCatalog,
): Result<ReadonlyMap<CatalogId, RecordSnapshot>, CatalogRevisionAuditError> {
  const records: readonly CatalogRecord[] = [
    ...catalog.movements,
    ...catalog.fragments,
    ...catalog.primaryTemplates,
    ...catalog.secondaryModules,
    ...catalog.compatibilityRules,
  ];
  const snapshots = new Map<CatalogId, RecordSnapshot>();
  for (const record of records) {
    if (snapshots.has(record.metadata.id)) {
      return {
        ok: false,
        error: { code: 'duplicateRecordId', id: record.metadata.id },
      };
    }
    const fingerprint = makeCanonicalFingerprint(record, true);
    if (!fingerprint.ok) {
      return { ok: false, error: { code: 'fingerprintFailed' } };
    }
    snapshots.set(record.metadata.id, {
      revision: record.metadata.revision,
      fingerprint: fingerprint.value,
    });
  }
  return { ok: true, value: snapshots };
}

export function auditCatalogReplacement(
  candidate: RoutineCatalog,
  installed: RoutineCatalog,
): Result<void, CatalogRevisionAuditError> {
  if (
    candidate.catalogVersion === installed.catalogVersion &&
    candidate.manifestFingerprint !== installed.manifestFingerprint
  ) {
    return {
      ok: false,
      error: {
        code: 'catalogVersionReused',
        version: candidate.catalogVersion,
      },
    };
  }
  const installedSnapshots = recordSnapshots(installed);
  const candidateSnapshots = recordSnapshots(candidate);
  if (!installedSnapshots.ok) {
    return installedSnapshots;
  }
  if (!candidateSnapshots.ok) {
    return candidateSnapshots;
  }
  for (const [id, candidateRecord] of candidateSnapshots.value) {
    const installedRecord = installedSnapshots.value.get(id);
    if (installedRecord === undefined) {
      continue;
    }
    if (candidateRecord.revision < installedRecord.revision) {
      return { ok: false, error: { code: 'revisionRegressed', id } };
    }
    if (
      candidateRecord.revision === installedRecord.revision &&
      candidateRecord.fingerprint !== installedRecord.fingerprint
    ) {
      return {
        ok: false,
        error: {
          code: 'contentChangedWithoutRevision',
          id,
          revision: candidateRecord.revision,
        },
      };
    }
  }
  return { ok: true, value: undefined };
}
