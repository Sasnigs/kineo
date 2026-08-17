import KineoCore
import Testing

@Suite("Catalog revision auditor")
struct CatalogRevisionAuditorTests {
    @Test("An unchanged catalog is accepted")
    func unchangedCatalogPasses() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        try CatalogRevisionAuditor.validateReplacement(catalog, replacing: catalog)
    }

    @Test("A content edit without a revision increment is rejected")
    func silentContentEditFails() throws {
        let installed = try PrototypeRoutineCatalog.make()
        let original = try #require(installed.movements.first)
        let changed = try movement(from: original, position: .adaptable, revision: original.metadata.revision)
        let candidate = try signed(
            installed,
            version: CatalogVersion(validating: "0.1.1"),
            movements: replacing(original, with: changed, in: installed.movements)
        )

        #expect(
            throws: CatalogRevisionAuditError.contentChangedWithoutRevision(
                original.metadata.id,
                original.metadata.revision
            )
        ) {
            try CatalogRevisionAuditor.validateReplacement(candidate, replacing: installed)
        }
    }

    @Test("A changed record with an incremented revision is accepted")
    func incrementedRevisionPasses() throws {
        let installed = try PrototypeRoutineCatalog.make()
        let original = try #require(installed.movements.first)
        let nextRevision = try ContentRevision(
            validating: original.metadata.revision.rawValue + CatalogRevisionFixture.increment
        )
        let changed = try movement(from: original, position: .adaptable, revision: nextRevision)
        let candidate = try signed(
            installed,
            version: CatalogVersion(validating: "0.1.1"),
            movements: replacing(original, with: changed, in: installed.movements)
        )

        try CatalogRevisionAuditor.validateReplacement(candidate, replacing: installed)
    }

    @Test("A changed manifest cannot reuse an installed catalog version")
    func catalogVersionReuseFails() throws {
        let installed = try PrototypeRoutineCatalog.make()
        let candidate = try RoutineCatalog.makeSigned(
            schemaVersion: installed.schemaVersion,
            catalogVersion: installed.catalogVersion,
            createdAt: TimestampMilliseconds(
                rawValue: installed.createdAt.rawValue + CatalogRevisionFixture.timestampIncrement
            ),
            buildEligibility: installed.buildEligibility,
            durationPolicies: installed.durationPolicies,
            movements: installed.movements,
            fragments: installed.fragments,
            primaryTemplates: installed.primaryTemplates,
            secondaryModules: installed.secondaryModules,
            compatibilityRules: installed.compatibilityRules
        )

        #expect(
            throws: CatalogRevisionAuditError.catalogVersionReused(installed.catalogVersion)
        ) {
            try CatalogRevisionAuditor.validateReplacement(candidate, replacing: installed)
        }
    }

    private func movement(
        from original: MovementDefinition,
        position: MovementPosition,
        revision: ContentRevision
    ) throws -> MovementDefinition {
        try MovementDefinition(
            metadata: ContentMetadata(
                id: original.metadata.id,
                revision: revision,
                reviewStatus: original.metadata.reviewStatus,
                locale: original.metadata.locale,
                displayNameKey: original.metadata.displayNameKey,
                accessibilityDescriptionKey: original.metadata.accessibilityDescriptionKey,
                contentOwner: original.metadata.contentOwner,
                reviewedBy: original.metadata.reviewedBy,
                reviewedAt: original.metadata.reviewedAt,
                reviewEvidenceID: original.metadata.reviewEvidenceID,
                intendedBuilds: original.metadata.intendedBuilds
            ),
            supportedAreas: original.supportedAreas,
            supportedLevels: original.supportedLevels,
            position: position,
            equipment: original.equipment,
            instructionKey: original.instructionKey,
            safetyCueKey: original.safetyCueKey,
            media: original.media,
            spokenCueKey: original.spokenCueKey,
            alternatives: original.alternatives
        )
    }

    private func replacing(
        _ original: MovementDefinition,
        with replacement: MovementDefinition,
        in movements: [MovementDefinition]
    ) -> [MovementDefinition] {
        movements.map { $0.metadata.id == original.metadata.id ? replacement : $0 }
    }

    private func signed(
        _ catalog: RoutineCatalog,
        version: CatalogVersion,
        movements: [MovementDefinition]
    ) throws -> RoutineCatalog {
        try RoutineCatalog.makeSigned(
            schemaVersion: catalog.schemaVersion,
            catalogVersion: version,
            createdAt: catalog.createdAt,
            buildEligibility: catalog.buildEligibility,
            durationPolicies: catalog.durationPolicies,
            movements: movements,
            fragments: catalog.fragments,
            primaryTemplates: catalog.primaryTemplates,
            secondaryModules: catalog.secondaryModules,
            compatibilityRules: catalog.compatibilityRules
        )
    }
}

private enum CatalogRevisionFixture {
    static let increment = 1
    static let timestampIncrement: Int64 = 1
}
