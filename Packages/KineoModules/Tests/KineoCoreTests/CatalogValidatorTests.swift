import KineoCore
import Testing

@Suite("Catalog validator")
struct CatalogValidatorTests {
    @Test("The complete prototype catalog passes internal validation")
    func prototypeCatalogIsValid() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        try CatalogValidator.validate(catalog, for: .internalPrototype, resources: resources())
    }

    @Test("Manifest tampering fails before content selection")
    func manifestMismatchFailsClosed() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let tampered = try RoutineCatalog(
            schemaVersion: catalog.schemaVersion,
            catalogVersion: catalog.catalogVersion,
            createdAt: catalog.createdAt,
            buildEligibility: catalog.buildEligibility,
            durationPolicies: catalog.durationPolicies,
            movements: catalog.movements,
            fragments: catalog.fragments,
            primaryTemplates: catalog.primaryTemplates,
            secondaryModules: catalog.secondaryModules,
            compatibilityRules: catalog.compatibilityRules,
            manifestFingerprint: SHA256Digest(
                validating: String(
                    repeating: CatalogValidatorFixture.invalidDigestCharacter,
                    count: SHA256Digest.encodedLength
                )
            )
        )

        #expect(throws: CatalogValidationError.manifestFingerprintMismatch) {
            try CatalogValidator.validate(
                tampered,
                for: .internalPrototype,
                resources: resources()
            )
        }
    }

    @Test("Missing localization and assets are explicit validation failures")
    func missingInstalledResourcesFail() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        var strings = try PrototypeRoutineCatalog.localizedStrings()
        let missingKey = try #require(catalog.movements.first?.instructionKey.rawValue)
        strings.removeValue(forKey: missingKey)
        let missingLocalization = CatalogValidationResources(
            localizedStrings: strings,
            assetDigestsByPath: try PrototypeRoutineCatalog.assetDigests()
        )
        #expect(throws: CatalogValidationError.missingLocalization(missingKey)) {
            try CatalogValidator.validate(
                catalog,
                for: .internalPrototype,
                resources: missingLocalization
            )
        }

        let missingAsset = CatalogValidationResources(
            localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
            assetDigestsByPath: [:]
        )
        let assetPath = try #require(catalog.movements.first?.media?.localBundlePath.rawValue)
        #expect(throws: CatalogValidationError.missingAsset(assetPath)) {
            try CatalogValidator.validate(
                catalog,
                for: .internalPrototype,
                resources: missingAsset
            )
        }
    }

    @Test("Removing referenced content invalidates the signed catalog")
    func missingReferenceFails() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let removedID = try CatalogID(
            validating: "kineo.prototype.movement.neck.base.1.v1"
        )
        let mutated = try signed(
            catalog,
            movements: catalog.movements.filter { $0.metadata.id != removedID }
        )

        #expect(throws: CatalogValidationError.missingReference(removedID)) {
            try CatalogValidator.validate(
                mutated,
                for: .internalPrototype,
                resources: resources()
            )
        }
    }

    @Test("Alternative cycles fail validation")
    func alternativeCycleFails() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let baseID = try CatalogID(validating: "kineo.prototype.movement.neck.base.1.v1")
        let alternativeID = try CatalogID(
            validating: "kineo.prototype.movement.neck.alternative.1.v1"
        )
        let alternative = try #require(
            catalog.movements.first(where: { $0.metadata.id == alternativeID })
        )
        let cycleReference = try AlternativeReference(
            movementID: baseID,
            reasonCodes: [.userPreference],
            dosePolicy: .preserveScheduledDose
        )
        let cyclicAlternative = try MovementDefinition(
            metadata: alternative.metadata,
            supportedAreas: alternative.supportedAreas,
            supportedLevels: alternative.supportedLevels,
            position: alternative.position,
            equipment: alternative.equipment,
            instructionKey: alternative.instructionKey,
            safetyCueKey: alternative.safetyCueKey,
            media: alternative.media,
            spokenCueKey: alternative.spokenCueKey,
            alternatives: [cycleReference]
        )
        let mutatedMovements = catalog.movements.map {
            $0.metadata.id == alternativeID ? cyclicAlternative : $0
        }
        let mutated = try signed(catalog, movements: mutatedMovements)

        #expect(throws: CatalogValidationError.alternativeCycle(baseID)) {
            try CatalogValidator.validate(
                mutated,
                for: .internalPrototype,
                resources: resources()
            )
        }
    }

    @Test("Allowed rules require every mechanical review flag")
    func incompleteCompatibilityReviewFails() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let original = try #require(catalog.compatibilityRules.first)
        let invalid = try CompatibilityRule(
            metadata: original.metadata,
            primaryArea: original.primaryArea,
            secondaryArea: original.secondaryArea,
            level: original.level,
            duration: original.duration,
            primaryTemplateID: original.primaryTemplateID,
            slotID: original.slotID,
            secondaryModuleID: original.secondaryModuleID,
            allowed: true,
            transitionOrderReviewed: false,
            duplicateMovementReviewed: original.duplicateMovementReviewed,
            equipmentReviewed: original.equipmentReviewed,
            positionChangesReviewed: original.positionChangesReviewed,
            cueInteractionReviewed: original.cueInteractionReviewed
        )
        let rules = catalog.compatibilityRules.map {
            $0.metadata.id == original.metadata.id ? invalid : $0
        }
        let mutated = try signed(catalog, compatibilityRules: rules)

        #expect(throws: CatalogValidationError.incompatibleContent(original.metadata.id)) {
            try CatalogValidator.validate(
                mutated,
                for: .internalPrototype,
                resources: resources()
            )
        }
    }

    @Test("A reviewed negative rule remains a valid primary-only fallback marker")
    func deniedCompatibilityRuleIsValid() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let original = try #require(catalog.compatibilityRules.first)
        let denied = try CompatibilityRule(
            metadata: original.metadata,
            primaryArea: original.primaryArea,
            secondaryArea: original.secondaryArea,
            level: original.level,
            duration: original.duration,
            primaryTemplateID: original.primaryTemplateID,
            slotID: original.slotID,
            secondaryModuleID: original.secondaryModuleID,
            allowed: false,
            transitionOrderReviewed: false,
            duplicateMovementReviewed: false,
            equipmentReviewed: false,
            positionChangesReviewed: false,
            cueInteractionReviewed: false
        )
        let rules = catalog.compatibilityRules.map {
            $0.metadata.id == original.metadata.id ? denied : $0
        }
        let mutated = try signed(catalog, compatibilityRules: rules)

        try CatalogValidator.validate(
            mutated,
            for: .internalPrototype,
            resources: resources()
        )
    }

    @Test("Duplicate eligible variants invalidate the catalog instead of using array order")
    func duplicateVariantFails() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let original = try #require(catalog.primaryTemplates.first)
        let duplicateMetadata = try ContentMetadata(
            id: CatalogID(validating: "kineo.primary.duplicate.gentle.quick.v1"),
            revision: original.metadata.revision,
            reviewStatus: original.metadata.reviewStatus,
            locale: original.metadata.locale,
            displayNameKey: original.metadata.displayNameKey,
            accessibilityDescriptionKey: original.metadata.accessibilityDescriptionKey,
            contentOwner: original.metadata.contentOwner,
            reviewedBy: original.metadata.reviewedBy,
            reviewedAt: original.metadata.reviewedAt,
            reviewEvidenceID: original.metadata.reviewEvidenceID,
            intendedBuilds: original.metadata.intendedBuilds
        )
        let duplicate = try PrimaryTemplateVariant(
            metadata: duplicateMetadata,
            area: original.area,
            level: original.level,
            duration: original.duration,
            nominalSeconds: original.nominalSeconds,
            items: original.items
        )
        let mutated = try RoutineCatalog.makeSigned(
            schemaVersion: catalog.schemaVersion,
            catalogVersion: catalog.catalogVersion,
            createdAt: catalog.createdAt,
            buildEligibility: catalog.buildEligibility,
            durationPolicies: catalog.durationPolicies,
            movements: catalog.movements,
            fragments: catalog.fragments,
            primaryTemplates: catalog.primaryTemplates + [duplicate],
            secondaryModules: catalog.secondaryModules,
            compatibilityRules: catalog.compatibilityRules
        )
        let key = "primary_template:\(original.area.rawValue):\(original.level.rawValue):\(original.duration.rawValue)"

        #expect(throws: CatalogValidationError.duplicateVariant(key)) {
            try CatalogValidator.validate(
                mutated,
                for: .internalPrototype,
                resources: resources()
            )
        }
    }

    @Test("An installed asset with different bytes fails integrity validation")
    func assetFingerprintMismatchFails() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let path = try #require(catalog.movements.first?.media?.localBundlePath.rawValue)
        let wrongDigest = try SHA256Digest(
            validating: String(
                repeating: CatalogValidatorFixture.invalidDigestCharacter,
                count: SHA256Digest.encodedLength
            )
        )
        let mismatched = CatalogValidationResources(
            localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
            assetDigestsByPath: [path: wrongDigest]
        )

        #expect(throws: CatalogValidationError.assetFingerprintMismatch(path)) {
            try CatalogValidator.validate(
                catalog,
                for: .internalPrototype,
                resources: mismatched
            )
        }
    }

    @Test("Prototype content cannot validate for a public build")
    func prototypeIsRejectedForPublicBuild() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        #expect(throws: CatalogValidationError.ineligibleCatalog(.publicRelease)) {
            try CatalogValidator.validate(
                catalog,
                for: .publicRelease,
                resources: resources()
            )
        }
    }

    private func resources() throws -> CatalogValidationResources {
        CatalogValidationResources(
            localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
            assetDigestsByPath: try PrototypeRoutineCatalog.assetDigests()
        )
    }

    private func signed(
        _ catalog: RoutineCatalog,
        movements: [MovementDefinition]? = nil,
        compatibilityRules: [CompatibilityRule]? = nil
    ) throws -> RoutineCatalog {
        try RoutineCatalog.makeSigned(
            schemaVersion: catalog.schemaVersion,
            catalogVersion: catalog.catalogVersion,
            createdAt: catalog.createdAt,
            buildEligibility: catalog.buildEligibility,
            durationPolicies: catalog.durationPolicies,
            movements: movements ?? catalog.movements,
            fragments: catalog.fragments,
            primaryTemplates: catalog.primaryTemplates,
            secondaryModules: catalog.secondaryModules,
            compatibilityRules: compatibilityRules ?? catalog.compatibilityRules
        )
    }
}

private enum CatalogValidatorFixture {
    static let invalidDigestCharacter = "0"
}
