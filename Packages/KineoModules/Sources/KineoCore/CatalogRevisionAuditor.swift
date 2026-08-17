/// Failures when comparing an installed catalog with a replacement candidate.
public enum CatalogRevisionAuditError: Error, Equatable, Sendable {
    case catalogVersionReused(CatalogVersion)
    case revisionRegressed(CatalogID)
    case contentChangedWithoutRevision(CatalogID, ContentRevision)
    case duplicateRecordID(CatalogID)
    case fingerprintFailure(CatalogValidationError)
}

/// Verifies immutable catalog and content-version history before activation.
public enum CatalogRevisionAuditor {
    /// Rejects reused catalog versions and silent edits to shipped content revisions.
    public static func validateReplacement(
        _ candidate: RoutineCatalog,
        replacing installed: RoutineCatalog
    ) throws(CatalogRevisionAuditError) {
        if candidate.catalogVersion == installed.catalogVersion,
           candidate.manifestFingerprint != installed.manifestFingerprint {
            throw .catalogVersionReused(candidate.catalogVersion)
        }

        let installedRecords = try snapshots(in: installed)
        let candidateRecords = try snapshots(in: candidate)
        for (id, candidateRecord) in candidateRecords {
            guard let installedRecord = installedRecords[id] else { continue }
            guard candidateRecord.revision >= installedRecord.revision else {
                throw .revisionRegressed(id)
            }
            if candidateRecord.revision == installedRecord.revision,
               candidateRecord.fingerprint != installedRecord.fingerprint {
                throw .contentChangedWithoutRevision(id, candidateRecord.revision)
            }
        }
    }

    private static func snapshots(
        in catalog: RoutineCatalog
    ) throws(CatalogRevisionAuditError) -> [CatalogID: CatalogRecordSnapshot] {
        var records = [CatalogID: CatalogRecordSnapshot]()
        try append(catalog.movements, to: &records)
        try append(catalog.fragments, to: &records)
        try append(catalog.primaryTemplates, to: &records)
        try append(catalog.secondaryModules, to: &records)
        try append(catalog.compatibilityRules, to: &records)
        return records
    }

    private static func append<Record>(
        _ source: [Record],
        to destination: inout [CatalogID: CatalogRecordSnapshot]
    ) throws(CatalogRevisionAuditError) where Record: CatalogRevisionRecord {
        for record in source {
            let fingerprint: SHA256Digest
            do {
                fingerprint = try CanonicalSHA256Fingerprint.make(
                    for: record,
                    sortingStringArrays: true
                )
            } catch let error {
                throw .fingerprintFailure(error)
            }
            let previous = destination.updateValue(CatalogRecordSnapshot(
                revision: record.metadata.revision,
                fingerprint: fingerprint
            ), forKey: record.metadata.id)
            guard case nil = previous else { throw .duplicateRecordID(record.metadata.id) }
        }
    }
}

private protocol CatalogRevisionRecord: Encodable {
    var metadata: ContentMetadata { get }
}

extension MovementDefinition: CatalogRevisionRecord {}
extension RoutineFragment: CatalogRevisionRecord {}
extension PrimaryTemplateVariant: CatalogRevisionRecord {}
extension SecondaryModuleVariant: CatalogRevisionRecord {}
extension CompatibilityRule: CatalogRevisionRecord {}

private struct CatalogRecordSnapshot {
    let revision: ContentRevision
    let fingerprint: SHA256Digest
}
