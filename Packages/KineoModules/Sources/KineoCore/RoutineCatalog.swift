import CryptoKit
import Foundation

/// Stable constants for the version-one catalog envelope.
public enum RoutineCatalogContract {
    public static let schemaVersion = 1
}

/// One immutable installed catalog and its manifest fingerprint.
public struct RoutineCatalog: Equatable, Codable, Sendable {
    public let schemaVersion: Int
    public let catalogVersion: CatalogVersion
    public let createdAt: TimestampMilliseconds
    public let buildEligibility: Set<BuildChannel>
    public let durationPolicies: [DurationPolicy]
    public let movements: [MovementDefinition]
    public let fragments: [RoutineFragment]
    public let primaryTemplates: [PrimaryTemplateVariant]
    public let secondaryModules: [SecondaryModuleVariant]
    public let compatibilityRules: [CompatibilityRule]
    public let manifestFingerprint: SHA256Digest

    public init(
        schemaVersion: Int,
        catalogVersion: CatalogVersion,
        createdAt: TimestampMilliseconds,
        buildEligibility: Set<BuildChannel>,
        durationPolicies: [DurationPolicy],
        movements: [MovementDefinition],
        fragments: [RoutineFragment],
        primaryTemplates: [PrimaryTemplateVariant],
        secondaryModules: [SecondaryModuleVariant],
        compatibilityRules: [CompatibilityRule],
        manifestFingerprint: SHA256Digest
    ) throws(CatalogValidationError) {
        guard schemaVersion > 0 else { throw .invalidArtifact("schemaVersion") }
        guard !buildEligibility.isEmpty else { throw .invalidArtifact("buildEligibility") }
        self.schemaVersion = schemaVersion
        self.catalogVersion = catalogVersion
        self.createdAt = createdAt
        self.buildEligibility = buildEligibility
        self.durationPolicies = durationPolicies
        self.movements = movements
        self.fragments = fragments
        self.primaryTemplates = primaryTemplates
        self.secondaryModules = secondaryModules
        self.compatibilityRules = compatibilityRules
        self.manifestFingerprint = manifestFingerprint
    }

    /// Creates a catalog whose fingerprint covers its complete canonical manifest.
    public static func makeSigned(
        schemaVersion: Int = RoutineCatalogContract.schemaVersion,
        catalogVersion: CatalogVersion,
        createdAt: TimestampMilliseconds,
        buildEligibility: Set<BuildChannel>,
        durationPolicies: [DurationPolicy],
        movements: [MovementDefinition],
        fragments: [RoutineFragment],
        primaryTemplates: [PrimaryTemplateVariant],
        secondaryModules: [SecondaryModuleVariant],
        compatibilityRules: [CompatibilityRule]
    ) throws(CatalogValidationError) -> Self {
        let manifest = CatalogManifestPayload(
            schemaVersion: schemaVersion,
            catalogVersion: catalogVersion,
            createdAt: createdAt,
            buildEligibility: buildEligibility,
            durationPolicies: durationPolicies,
            movements: movements,
            fragments: fragments,
            primaryTemplates: primaryTemplates,
            secondaryModules: secondaryModules,
            compatibilityRules: compatibilityRules
        )
        let fingerprint = try CatalogManifestFingerprint.make(for: manifest)
        return try Self(
            schemaVersion: schemaVersion,
            catalogVersion: catalogVersion,
            createdAt: createdAt,
            buildEligibility: buildEligibility,
            durationPolicies: durationPolicies,
            movements: movements,
            fragments: fragments,
            primaryTemplates: primaryTemplates,
            secondaryModules: secondaryModules,
            compatibilityRules: compatibilityRules,
            manifestFingerprint: fingerprint
        )
    }

    /// Recomputes the fingerprint from the catalog content.
    public func computedManifestFingerprint() throws(CatalogValidationError) -> SHA256Digest {
        try CatalogManifestFingerprint.make(for: CatalogManifestPayload(catalog: self))
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                schemaVersion: values.decode(Int.self, forKey: .schemaVersion),
                catalogVersion: values.decode(CatalogVersion.self, forKey: .catalogVersion),
                createdAt: values.decode(TimestampMilliseconds.self, forKey: .createdAt),
                buildEligibility: values.decode(Set<BuildChannel>.self, forKey: .buildEligibility),
                durationPolicies: values.decode([DurationPolicy].self, forKey: .durationPolicies),
                movements: values.decode([MovementDefinition].self, forKey: .movements),
                fragments: values.decode([RoutineFragment].self, forKey: .fragments),
                primaryTemplates: values.decode(
                    [PrimaryTemplateVariant].self,
                    forKey: .primaryTemplates
                ),
                secondaryModules: values.decode(
                    [SecondaryModuleVariant].self,
                    forKey: .secondaryModules
                ),
                compatibilityRules: values.decode(
                    [CompatibilityRule].self,
                    forKey: .compatibilityRules
                ),
                manifestFingerprint: values.decode(
                    SHA256Digest.self,
                    forKey: .manifestFingerprint
                )
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion,
                in: values,
                debugDescription: "Invalid catalog envelope: \(error)."
            )
        }
    }
}

private struct CatalogManifestPayload: Encodable {
    let schemaVersion: Int
    let catalogVersion: CatalogVersion
    let createdAt: TimestampMilliseconds
    let buildEligibility: Set<BuildChannel>
    let durationPolicies: [DurationPolicy]
    let movements: [MovementDefinition]
    let fragments: [RoutineFragment]
    let primaryTemplates: [PrimaryTemplateVariant]
    let secondaryModules: [SecondaryModuleVariant]
    let compatibilityRules: [CompatibilityRule]

    init(
        schemaVersion: Int,
        catalogVersion: CatalogVersion,
        createdAt: TimestampMilliseconds,
        buildEligibility: Set<BuildChannel>,
        durationPolicies: [DurationPolicy],
        movements: [MovementDefinition],
        fragments: [RoutineFragment],
        primaryTemplates: [PrimaryTemplateVariant],
        secondaryModules: [SecondaryModuleVariant],
        compatibilityRules: [CompatibilityRule]
    ) {
        self.schemaVersion = schemaVersion
        self.catalogVersion = catalogVersion
        self.createdAt = createdAt
        self.buildEligibility = buildEligibility
        self.durationPolicies = durationPolicies.sorted { $0.variant.rawValue < $1.variant.rawValue }
        self.movements = movements.sorted(by: Self.contentOrder)
        self.fragments = fragments.sorted(by: Self.contentOrder)
        self.primaryTemplates = primaryTemplates.sorted(by: Self.contentOrder)
        self.secondaryModules = secondaryModules.sorted(by: Self.contentOrder)
        self.compatibilityRules = compatibilityRules.sorted(by: Self.contentOrder)
    }

    init(catalog: RoutineCatalog) {
        self.init(
            schemaVersion: catalog.schemaVersion,
            catalogVersion: catalog.catalogVersion,
            createdAt: catalog.createdAt,
            buildEligibility: catalog.buildEligibility,
            durationPolicies: catalog.durationPolicies,
            movements: catalog.movements,
            fragments: catalog.fragments,
            primaryTemplates: catalog.primaryTemplates,
            secondaryModules: catalog.secondaryModules,
            compatibilityRules: catalog.compatibilityRules
        )
    }

    private static func contentOrder<T>(_ lhs: T, _ rhs: T) -> Bool where T: CatalogRecord {
        let left = lhs.metadata
        let right = rhs.metadata
        if left.id.rawValue == right.id.rawValue {
            return left.revision < right.revision
        }
        return left.id.rawValue < right.id.rawValue
    }
}

private protocol CatalogRecord {
    var metadata: ContentMetadata { get }
}

extension MovementDefinition: CatalogRecord {}
extension RoutineFragment: CatalogRecord {}
extension PrimaryTemplateVariant: CatalogRecord {}
extension SecondaryModuleVariant: CatalogRecord {}
extension CompatibilityRule: CatalogRecord {}

private enum CatalogManifestFingerprint {
    static func make(
        for manifest: some Encodable
    ) throws(CatalogValidationError) -> SHA256Digest {
        do {
            let encoded = try JSONEncoder().encode(manifest)
            let object = try JSONSerialization.jsonObject(with: encoded)
            let normalized = normalize(object)
            let canonical = try JSONSerialization.data(
                withJSONObject: normalized,
                options: [.sortedKeys]
            )
            let digest = SHA256.hash(data: canonical)
                .map { String(format: "%02x", $0) }
                .joined()
            return try SHA256Digest(validating: digest)
        } catch {
            throw .invalidArtifact("manifestEncoding")
        }
    }

    private static func normalize(_ value: Any) -> Any {
        if let dictionary = value as? [String: Any] {
            return dictionary.mapValues(normalize)
        }
        if let array = value as? [Any] {
            let normalized = array.map(normalize)
            if let strings = normalized as? [String] {
                return strings.sorted()
            }
            return normalized
        }
        return value
    }
}
