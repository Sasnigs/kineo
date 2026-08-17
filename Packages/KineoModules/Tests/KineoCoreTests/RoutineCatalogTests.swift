import Foundation
import KineoCore
import Testing

@Suite("Routine catalog manifest")
struct RoutineCatalogTests {
    private let createdAt = TimestampMilliseconds(rawValue: 1_750_000_000_000)

    @Test("Signing is stable across unordered catalog collection input")
    func canonicalManifestOrdering() throws {
        let first = try movement(id: "kineo.prototype.movement.neck.base.1.v1")
        let second = try movement(id: "kineo.prototype.movement.neck.base.2.v1")
        let quick = try quickPolicy()
        let standard = try standardPolicy()

        let forward = try signedCatalog(
            durationPolicies: [quick, standard],
            movements: [first, second]
        )
        let reversed = try signedCatalog(
            durationPolicies: [standard, quick],
            movements: [second, first]
        )

        #expect(forward.manifestFingerprint == reversed.manifestFingerprint)
        #expect(try forward.computedManifestFingerprint() == forward.manifestFingerprint)
    }

    @Test("Any covered manifest mutation changes the computed fingerprint")
    func manifestMutationChangesFingerprint() throws {
        let original = try signedCatalog(
            durationPolicies: [quickPolicy(), standardPolicy()],
            movements: [movement(id: "kineo.prototype.movement.neck.base.1.v1")]
        )
        let changed = try RoutineCatalog.makeSigned(
            catalogVersion: CatalogVersion(validating: "1.0.1"),
            createdAt: createdAt,
            buildEligibility: [.internalPrototype],
            durationPolicies: original.durationPolicies,
            movements: original.movements,
            fragments: [],
            primaryTemplates: [],
            secondaryModules: [],
            compatibilityRules: []
        )

        #expect(original.manifestFingerprint != changed.manifestFingerprint)
    }

    @Test("Catalog decoding rejects an invalid envelope")
    func catalogDecodingRevalidatesEnvelope() throws {
        let catalog = try signedCatalog(durationPolicies: [quickPolicy()], movements: [])
        let encoded = try JSONEncoder().encode(catalog)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object["schemaVersion"] = 0
        let invalid = try JSONSerialization.data(withJSONObject: object)

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(RoutineCatalog.self, from: invalid)
        }
    }

    private func signedCatalog(
        durationPolicies: [DurationPolicy],
        movements: [MovementDefinition]
    ) throws -> RoutineCatalog {
        try RoutineCatalog.makeSigned(
            catalogVersion: CatalogVersion(validating: "1.0.0"),
            createdAt: createdAt,
            buildEligibility: [.internalPrototype],
            durationPolicies: durationPolicies,
            movements: movements,
            fragments: [],
            primaryTemplates: [],
            secondaryModules: [],
            compatibilityRules: []
        )
    }

    private func movement(id: String) throws -> MovementDefinition {
        try MovementDefinition(
            metadata: ContentMetadata(
                id: CatalogID(validating: id),
                revision: ContentRevision(validating: 1),
                reviewStatus: .prototypePlaceholder,
                locale: "en-US",
                displayNameKey: NonEmptyString(validating: "prototype.display-name"),
                accessibilityDescriptionKey: NonEmptyString(
                    validating: "prototype.accessibility-description"
                ),
                contentOwner: NonEmptyString(validating: "Kineo prototype"),
                reviewedBy: nil,
                reviewedAt: nil,
                reviewEvidenceID: nil,
                intendedBuilds: [.internalPrototype]
            ),
            supportedAreas: [.neck],
            supportedLevels: [.gentle],
            position: .prototypeAbstract,
            equipment: [],
            instructionKey: NonEmptyString(validating: "prototype.instruction"),
            safetyCueKey: NonEmptyString(validating: "prototype.safety"),
            media: nil,
            spokenCueKey: nil,
            alternatives: []
        )
    }

    private func quickPolicy() throws -> DurationPolicy {
        try DurationPolicy(
            variant: .quick,
            nominalSeconds: PrototypeCatalogDurations.quickNominalSeconds,
            minimumSeconds: PrototypeCatalogDurations.quickMinimumSeconds,
            maximumSeconds: PrototypeCatalogDurations.quickMaximumSeconds
        )
    }

    private func standardPolicy() throws -> DurationPolicy {
        try DurationPolicy(
            variant: .standard,
            nominalSeconds: PrototypeCatalogDurations.standardNominalSeconds,
            minimumSeconds: PrototypeCatalogDurations.standardMinimumSeconds,
            maximumSeconds: PrototypeCatalogDurations.standardMaximumSeconds
        )
    }
}
