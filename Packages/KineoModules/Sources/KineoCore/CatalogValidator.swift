import Foundation

/// Installed localization and asset evidence used during catalog validation.
public struct CatalogValidationResources: Equatable, Sendable {
    public let localizedStrings: [String: String]
    public let assetDigestsByPath: [String: SHA256Digest]

    public init(
        localizedStrings: [String: String],
        assetDigestsByPath: [String: SHA256Digest]
    ) {
        self.localizedStrings = localizedStrings
        self.assetDigestsByPath = assetDigestsByPath
    }
}

/// Fail-closed validation for an installed routine catalog.
public enum CatalogValidator {
    /// Validates the complete catalog for one build channel and installed resource set.
    public static func validate(
        _ catalog: RoutineCatalog,
        for channel: BuildChannel,
        resources: CatalogValidationResources
    ) throws(CatalogValidationError) {
        try validateEnvelope(catalog, channel: channel)
        try validateRecordIDs(catalog)
        try validateDurationPolicies(catalog)
        try validateVariants(catalog, channel: channel)

        let movementsByID = try uniqueRecords(catalog.movements)
        let fragmentsByID = try uniqueRecords(catalog.fragments)
        let primariesByID = try uniqueRecords(catalog.primaryTemplates)
        let modulesByID = try uniqueRecords(catalog.secondaryModules)

        try validateMovements(
            catalog.movements,
            channel: channel,
            resources: resources,
            movementsByID: movementsByID
        )
        try validateAlternativeCycles(
            movements: catalog.movements,
            movementsByID: movementsByID,
            channel: channel
        )
        try validateArtifacts(
            catalog: catalog,
            channel: channel,
            resources: resources,
            movementsByID: movementsByID,
            fragmentsByID: fragmentsByID
        )
        try validateCompatibilityRules(
            catalog: catalog,
            channel: channel,
            resources: resources,
            movementsByID: movementsByID,
            fragmentsByID: fragmentsByID,
            primariesByID: primariesByID,
            modulesByID: modulesByID
        )
    }

    private static func validateEnvelope(
        _ catalog: RoutineCatalog,
        channel: BuildChannel
    ) throws(CatalogValidationError) {
        guard catalog.schemaVersion == RoutineCatalogContract.schemaVersion else {
            throw .unsupportedSchemaVersion(catalog.schemaVersion)
        }
        guard catalog.buildEligibility.contains(channel) else {
            throw .ineligibleCatalog(channel)
        }
        guard try catalog.computedManifestFingerprint() == catalog.manifestFingerprint else {
            throw .manifestFingerprintMismatch
        }
        if channel == .publicRelease {
            let prototype = allMetadata(in: catalog).first {
                $0.reviewStatus == .prototypePlaceholder
            }
            if let prototype {
                throw .ineligibleRecord(prototype.id)
            }
        }
    }

    private static func validateRecordIDs(
        _ catalog: RoutineCatalog
    ) throws(CatalogValidationError) {
        var seen = Set<CatalogID>()
        for metadata in allMetadata(in: catalog) {
            guard seen.insert(metadata.id).inserted else {
                throw .duplicateRecordID(metadata.id)
            }
        }
    }

    private static func validateDurationPolicies(
        _ catalog: RoutineCatalog
    ) throws(CatalogValidationError) {
        for duration in CatalogValidationConstants.durations {
            let matches = catalog.durationPolicies.count { $0.variant == duration }
            guard matches == CatalogValidationConstants.exactMatchCount else {
                throw .missingDurationPolicy(duration)
            }
        }
    }

    private static func validateVariants(
        _ catalog: RoutineCatalog,
        channel: BuildChannel
    ) throws(CatalogValidationError) {
        var keys = Set<CatalogVariantKey>()
        for fragment in catalog.fragments where fragment.metadata.intendedBuilds.contains(channel) {
            try requireEligible(fragment.metadata, channel: channel)
            try insertVariant(
                CatalogVariantKey(
                    role: .fragment,
                    area: fragment.area,
                    level: fragment.level,
                    duration: fragment.duration
                ),
                into: &keys
            )
        }
        for primary in catalog.primaryTemplates where primary.metadata.intendedBuilds.contains(channel) {
            try requireEligible(primary.metadata, channel: channel)
            try insertVariant(
                CatalogVariantKey(
                    role: .primaryTemplate,
                    area: primary.area,
                    level: primary.level,
                    duration: primary.duration
                ),
                into: &keys
            )
        }
        for module in catalog.secondaryModules where module.metadata.intendedBuilds.contains(channel) {
            try requireEligible(module.metadata, channel: channel)
            try insertVariant(
                CatalogVariantKey(
                    role: .secondaryModule,
                    area: module.area,
                    level: module.level,
                    duration: module.duration
                ),
                into: &keys
            )
        }
        var compatibilityKeys = Set<CatalogCompatibilityKey>()
        for rule in catalog.compatibilityRules where rule.metadata.intendedBuilds.contains(channel) {
            try requireEligible(rule.metadata, channel: channel)
            let key = CatalogCompatibilityKey(
                primaryArea: rule.primaryArea,
                secondaryArea: rule.secondaryArea,
                level: rule.level,
                duration: rule.duration
            )
            guard compatibilityKeys.insert(key).inserted else {
                throw .duplicateVariant(key.description)
            }
        }
    }

    private static func validateMovements(
        _ movements: [MovementDefinition],
        channel: BuildChannel,
        resources: CatalogValidationResources,
        movementsByID: [CatalogID: MovementDefinition]
    ) throws(CatalogValidationError) {
        for movement in movements where movement.metadata.intendedBuilds.contains(channel) {
            try requireEligible(movement.metadata, channel: channel)
            try validateMetadataLocalization(movement.metadata, resources: resources)
            try requireLocalization(movement.instructionKey, resources: resources)
            try requireLocalization(movement.safetyCueKey, resources: resources)
            if let spokenCueKey = movement.spokenCueKey {
                try requireLocalization(spokenCueKey, resources: resources)
            }
            if let media = movement.media {
                try validate(media: media, channel: channel, resources: resources)
            }
            for alternative in movement.alternatives {
                guard let target = movementsByID[alternative.movementID] else {
                    throw .missingReference(alternative.movementID)
                }
                try requireEligible(target.metadata, channel: channel)
                guard target.supportedAreas == movement.supportedAreas,
                      target.supportedLevels == movement.supportedLevels else {
                    throw .invalidAlternative(movement.metadata.id.rawValue)
                }
            }
        }
    }

    private static func validateAlternativeCycles(
        movements: [MovementDefinition],
        movementsByID: [CatalogID: MovementDefinition],
        channel: BuildChannel
    ) throws(CatalogValidationError) {
        var visiting = Set<CatalogID>()
        var visited = Set<CatalogID>()

        func visit(_ id: CatalogID) throws(CatalogValidationError) {
            if visited.contains(id) { return }
            guard visiting.insert(id).inserted else { throw .alternativeCycle(id) }
            guard let movement = movementsByID[id] else { throw .missingReference(id) }
            for reference in movement.alternatives {
                guard let target = movementsByID[reference.movementID] else {
                    throw .missingReference(reference.movementID)
                }
                try requireEligible(target.metadata, channel: channel)
                try visit(reference.movementID)
            }
            visiting.remove(id)
            visited.insert(id)
        }

        for movement in movements where movement.metadata.isEligible(for: channel) {
            try visit(movement.metadata.id)
        }
    }

    private static func validateArtifacts(
        catalog: RoutineCatalog,
        channel: BuildChannel,
        resources: CatalogValidationResources,
        movementsByID: [CatalogID: MovementDefinition],
        fragmentsByID: [CatalogID: RoutineFragment]
    ) throws(CatalogValidationError) {
        for fragment in catalog.fragments where fragment.metadata.isEligible(for: channel) {
            try validateMetadataLocalization(fragment.metadata, resources: resources)
            _ = try pathRange(
                items: fragment.items,
                area: fragment.area,
                level: fragment.level,
                channel: channel,
                movementsByID: movementsByID
            )
        }
        for module in catalog.secondaryModules where module.metadata.isEligible(for: channel) {
            try validateMetadataLocalization(module.metadata, resources: resources)
            let range = try pathRange(
                items: module.items,
                area: module.area,
                level: module.level,
                channel: channel,
                movementsByID: movementsByID
            )
            guard try sequenceNominalSeconds(module.items) == module.nominalSeconds,
                  range.contains(module.nominalSeconds) else {
                throw .invalidDuration(module.metadata.id.rawValue)
            }
        }
        for primary in catalog.primaryTemplates where primary.metadata.isEligible(for: channel) {
            try validateMetadataLocalization(primary.metadata, resources: resources)
            let defaultRange = try primaryDefaultPathRange(
                primary,
                channel: channel,
                movementsByID: movementsByID,
                fragmentsByID: fragmentsByID
            )
            let defaultNominal = try primaryDefaultNominalSeconds(
                primary,
                channel: channel,
                fragmentsByID: fragmentsByID
            )
            guard defaultNominal == primary.nominalSeconds,
                  defaultRange.contains(primary.nominalSeconds) else {
                throw .invalidDuration(primary.metadata.id.rawValue)
            }
            let policy = try durationPolicy(for: primary.duration, in: catalog)
            guard policy.contains(defaultRange), policy.contains(primary.nominalSeconds) else {
                throw .invalidDuration(primary.metadata.id.rawValue)
            }
        }
    }

    private static func validateCompatibilityRules(
        catalog: RoutineCatalog,
        channel: BuildChannel,
        resources: CatalogValidationResources,
        movementsByID: [CatalogID: MovementDefinition],
        fragmentsByID: [CatalogID: RoutineFragment],
        primariesByID: [CatalogID: PrimaryTemplateVariant],
        modulesByID: [CatalogID: SecondaryModuleVariant]
    ) throws(CatalogValidationError) {
        for rule in catalog.compatibilityRules where rule.metadata.intendedBuilds.contains(channel) {
            try requireEligible(rule.metadata, channel: channel)
            try validateMetadataLocalization(rule.metadata, resources: resources)
            guard let primary = primariesByID[rule.primaryTemplateID] else {
                throw .missingReference(rule.primaryTemplateID)
            }
            guard let module = modulesByID[rule.secondaryModuleID] else {
                throw .missingReference(rule.secondaryModuleID)
            }
            try requireEligible(primary.metadata, channel: channel)
            try requireEligible(module.metadata, channel: channel)
            guard primary.area == rule.primaryArea,
                  module.area == rule.secondaryArea,
                  primary.level == rule.level,
                  module.level == rule.level,
                  primary.duration == rule.duration,
                  module.duration == rule.duration else {
                throw .incompatibleContent(rule.metadata.id)
            }
            guard let slot = primary.items.compactMap(\.slot).first,
                  slot.slotID == rule.slotID,
                  slot.kind == module.slotKind else {
                throw .incompatibleContent(rule.metadata.id)
            }
            if !rule.allowed { continue }
            guard rule.hasCompleteMechanicalReview else {
                throw .incompatibleContent(rule.metadata.id)
            }
            guard module.equipment.isSubset(of: slot.allowedEquipment),
                  slot.allowedPositions.contains(module.position) else {
                throw .incompatibleContent(rule.metadata.id)
            }
            let moduleRange = try pathRange(
                items: module.items,
                area: module.area,
                level: module.level,
                channel: channel,
                movementsByID: movementsByID
            )
            guard slot.budget.contains(moduleRange),
                  slot.budget.contains(module.nominalSeconds) else {
                throw .incompatibleContent(rule.metadata.id)
            }
            let range = try composedPathRange(
                primary: primary,
                module: module,
                channel: channel,
                movementsByID: movementsByID
            )
            let nominal = try composedNominalSeconds(
                primary: primary,
                module: module,
                channel: channel,
                fragmentsByID: fragmentsByID
            )
            let policy = try durationPolicy(for: rule.duration, in: catalog)
            guard policy.contains(range), policy.contains(nominal), range.contains(nominal) else {
                throw .invalidDuration(rule.metadata.id.rawValue)
            }
        }
    }

    private static func primaryDefaultPathRange(
        _ primary: PrimaryTemplateVariant,
        channel: BuildChannel,
        movementsByID: [CatalogID: MovementDefinition],
        fragmentsByID: [CatalogID: RoutineFragment]
    ) throws(CatalogValidationError) -> CatalogPathRange {
        var total = CatalogPathRange.zero
        for item in primary.items {
            if let slot = item.slot {
                guard let fragment = fragmentsByID[slot.defaultFragmentID] else {
                    throw .missingReference(slot.defaultFragmentID)
                }
                try requireEligible(fragment.metadata, channel: channel)
                guard fragment.area == primary.area,
                      fragment.level == primary.level,
                      fragment.duration == primary.duration else {
                    throw .incompatibleContent(primary.metadata.id)
                }
                let range = try pathRange(
                    items: fragment.items,
                    area: fragment.area,
                    level: fragment.level,
                    channel: channel,
                    movementsByID: movementsByID
                )
                guard slot.budget.contains(range),
                      slot.budget.contains(try sequenceNominalSeconds(fragment.items)) else {
                    throw .invalidDuration(fragment.metadata.id.rawValue)
                }
                total = try total.adding(range)
            } else {
                total = try total.adding(
                    pathRange(
                        item: item,
                        area: primary.area,
                        level: primary.level,
                        channel: channel,
                        movementsByID: movementsByID
                    )
                )
            }
        }
        return total
    }

    private static func composedPathRange(
        primary: PrimaryTemplateVariant,
        module: SecondaryModuleVariant,
        channel: BuildChannel,
        movementsByID: [CatalogID: MovementDefinition]
    ) throws(CatalogValidationError) -> CatalogPathRange {
        var total = CatalogPathRange.zero
        for item in primary.items {
            if item.slot != nil {
                total = try total.adding(
                    pathRange(
                        items: module.items,
                        area: module.area,
                        level: module.level,
                        channel: channel,
                        movementsByID: movementsByID
                    )
                )
            } else {
                total = try total.adding(
                    pathRange(
                        item: item,
                        area: primary.area,
                        level: primary.level,
                        channel: channel,
                        movementsByID: movementsByID
                    )
                )
            }
        }
        return total
    }

    private static func primaryDefaultNominalSeconds(
        _ primary: PrimaryTemplateVariant,
        channel: BuildChannel,
        fragmentsByID: [CatalogID: RoutineFragment]
    ) throws(CatalogValidationError) -> Int {
        var seconds = 0
        for item in primary.items {
            if let slot = item.slot {
                guard let fragment = fragmentsByID[slot.defaultFragmentID] else {
                    throw .missingReference(slot.defaultFragmentID)
                }
                try requireEligible(fragment.metadata, channel: channel)
                seconds = try adding(seconds, sequenceNominalSeconds(fragment.items))
            } else {
                seconds = try adding(seconds, nominalSeconds(item))
            }
        }
        return seconds
    }

    private static func composedNominalSeconds(
        primary: PrimaryTemplateVariant,
        module: SecondaryModuleVariant,
        channel: BuildChannel,
        fragmentsByID: [CatalogID: RoutineFragment]
    ) throws(CatalogValidationError) -> Int {
        _ = try primaryDefaultNominalSeconds(
            primary,
            channel: channel,
            fragmentsByID: fragmentsByID
        )
        var seconds = 0
        for item in primary.items {
            seconds = try adding(
                seconds,
                item.slot == nil ? nominalSeconds(item) : module.nominalSeconds
            )
        }
        return seconds
    }

    private static func pathRange(
        items: [SequenceItem],
        area: BodyArea,
        level: RoutineLevel,
        channel: BuildChannel,
        movementsByID: [CatalogID: MovementDefinition]
    ) throws(CatalogValidationError) -> CatalogPathRange {
        var total = CatalogPathRange.zero
        for item in items {
            total = try total.adding(
                pathRange(
                    item: item,
                    area: area,
                    level: level,
                    channel: channel,
                    movementsByID: movementsByID
                )
            )
        }
        return total
    }

    private static func pathRange(
        item: SequenceItem,
        area: BodyArea,
        level: RoutineLevel,
        channel: BuildChannel,
        movementsByID: [CatalogID: MovementDefinition]
    ) throws(CatalogValidationError) -> CatalogPathRange {
        if let fixedSeconds = item.fixedSeconds {
            return CatalogPathRange(minimumSeconds: fixedSeconds, maximumSeconds: fixedSeconds)
        }
        guard let movementID = item.movementID,
              let dose = item.dose else {
            throw .invalidSequenceItem(item.kind.rawValue)
        }
        guard let movement = movementsByID[movementID] else { throw .missingReference(movementID) }
        try requireEligible(movement.metadata, channel: channel)
        guard movement.supportedAreas.contains(area), movement.supportedLevels.contains(level) else {
            throw .incompatibleContent(movement.metadata.id)
        }

        var values = [dose.estimatedSeconds]
        for alternative in movement.alternatives {
            guard let target = movementsByID[alternative.movementID] else {
                throw .missingReference(alternative.movementID)
            }
            try requireEligible(target.metadata, channel: channel)
            switch alternative.dosePolicy {
            case .preserveScheduledDose:
                values.append(dose.estimatedSeconds)
            case .explicit(let alternativeDose):
                values.append(alternativeDose.estimatedSeconds)
            }
        }
        guard let minimum = values.min(), let maximum = values.max() else {
            throw .invalidDuration(item.itemID.rawValue)
        }
        return CatalogPathRange(minimumSeconds: minimum, maximumSeconds: maximum)
    }

    private static func validate(
        media: MediaReference,
        channel: BuildChannel,
        resources: CatalogValidationResources
    ) throws(CatalogValidationError) {
        try requireLocalization(media.accessibilityDescriptionKey, resources: resources)
        if let transcriptKey = media.transcriptKey {
            try requireLocalization(transcriptKey, resources: resources)
        }
        guard CatalogMediaKinds.allowed.contains(media.kind.rawValue) else {
            throw .invalidMedia(media.assetID.rawValue)
        }
        if media.kind.rawValue == CatalogMediaKinds.video {
            guard media.captionTrackPath != nil || media.transcriptKey != nil else {
                throw .invalidMedia(media.assetID.rawValue)
            }
        }
        if channel == .publicRelease, media.licenseEvidenceID == nil {
            throw .invalidMedia(media.assetID.rawValue)
        }
        let path = media.localBundlePath.rawValue
        guard let installedDigest = resources.assetDigestsByPath[path] else {
            throw .missingAsset(path)
        }
        guard installedDigest == media.sha256 else {
            throw .assetFingerprintMismatch(path)
        }
    }

    private static func validateMetadataLocalization(
        _ metadata: ContentMetadata,
        resources: CatalogValidationResources
    ) throws(CatalogValidationError) {
        try requireLocalization(metadata.displayNameKey, resources: resources)
        if let accessibilityDescriptionKey = metadata.accessibilityDescriptionKey {
            try requireLocalization(accessibilityDescriptionKey, resources: resources)
        }
    }

    private static func requireLocalization(
        _ key: NonEmptyString,
        resources: CatalogValidationResources
    ) throws(CatalogValidationError) {
        guard let value = resources.localizedStrings[key.rawValue],
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw .missingLocalization(key.rawValue)
        }
    }

    private static func requireEligible(
        _ metadata: ContentMetadata,
        channel: BuildChannel
    ) throws(CatalogValidationError) {
        guard metadata.isEligible(for: channel) else { throw .ineligibleRecord(metadata.id) }
    }

    private static func durationPolicy(
        for duration: DurationVariant,
        in catalog: RoutineCatalog
    ) throws(CatalogValidationError) -> DurationPolicy {
        guard let policy = catalog.durationPolicies.first(where: { $0.variant == duration }) else {
            throw .missingDurationPolicy(duration)
        }
        return policy
    }

    private static func insertVariant(
        _ key: CatalogVariantKey,
        into keys: inout Set<CatalogVariantKey>
    ) throws(CatalogValidationError) {
        guard keys.insert(key).inserted else { throw .duplicateVariant(key.description) }
    }

    private static func uniqueRecords<Record>(
        _ records: [Record]
    ) throws(CatalogValidationError) -> [CatalogID: Record] where Record: CatalogMetadataProviding {
        var byID = [CatalogID: Record]()
        for record in records {
            guard byID.updateValue(record, forKey: record.metadata.id) == nil else {
                throw .duplicateRecordID(record.metadata.id)
            }
        }
        return byID
    }

    private static func allMetadata(in catalog: RoutineCatalog) -> [ContentMetadata] {
        catalog.movements.map(\.metadata) +
            catalog.fragments.map(\.metadata) +
            catalog.primaryTemplates.map(\.metadata) +
            catalog.secondaryModules.map(\.metadata) +
            catalog.compatibilityRules.map(\.metadata)
    }

    private static func sequenceNominalSeconds(
        _ items: [SequenceItem]
    ) throws(CatalogValidationError) -> Int {
        var seconds = 0
        for item in items {
            seconds = try adding(seconds, nominalSeconds(item))
        }
        return seconds
    }

    private static func nominalSeconds(_ item: SequenceItem) -> Int {
        item.dose?.estimatedSeconds ?? item.fixedSeconds ?? 0
    }

    private static func adding(
        _ lhs: Int,
        _ rhs: Int
    ) throws(CatalogValidationError) -> Int {
        let (sum, overflow) = lhs.addingReportingOverflow(rhs)
        guard !overflow else { throw .invalidDuration("overflow") }
        return sum
    }
}

private protocol CatalogMetadataProviding {
    var metadata: ContentMetadata { get }
}

extension MovementDefinition: CatalogMetadataProviding {}
extension RoutineFragment: CatalogMetadataProviding {}
extension PrimaryTemplateVariant: CatalogMetadataProviding {}
extension SecondaryModuleVariant: CatalogMetadataProviding {}

private struct CatalogVariantKey: Hashable {
    let role: ContentRole
    let area: BodyArea
    let level: RoutineLevel
    let duration: DurationVariant

    var description: String {
        "\(role.rawValue):\(area.rawValue):\(level.rawValue):\(duration.rawValue)"
    }
}

private struct CatalogCompatibilityKey: Hashable {
    let primaryArea: BodyArea
    let secondaryArea: BodyArea
    let level: RoutineLevel
    let duration: DurationVariant

    var description: String {
        "compatibility:\(primaryArea.rawValue):\(secondaryArea.rawValue):\(level.rawValue):\(duration.rawValue)"
    }
}

private struct CatalogPathRange {
    static let zero = CatalogPathRange(minimumSeconds: 0, maximumSeconds: 0)

    let minimumSeconds: Int
    let maximumSeconds: Int

    func adding(_ other: Self) throws(CatalogValidationError) -> Self {
        let (minimum, minimumOverflow) = minimumSeconds.addingReportingOverflow(other.minimumSeconds)
        let (maximum, maximumOverflow) = maximumSeconds.addingReportingOverflow(other.maximumSeconds)
        guard !minimumOverflow, !maximumOverflow else { throw .invalidDuration("overflow") }
        return Self(minimumSeconds: minimum, maximumSeconds: maximum)
    }

    func contains(_ seconds: Int) -> Bool {
        minimumSeconds <= seconds && seconds <= maximumSeconds
    }
}

private extension DurationPolicy {
    func contains(_ seconds: Int) -> Bool {
        minimumSeconds <= seconds && seconds <= maximumSeconds
    }

    func contains(_ range: CatalogPathRange) -> Bool {
        minimumSeconds <= range.minimumSeconds && range.maximumSeconds <= maximumSeconds
    }
}

private extension DurationBudget {
    func contains(_ seconds: Int) -> Bool {
        minimumSeconds <= seconds && seconds <= maximumSeconds
    }

    func contains(_ range: CatalogPathRange) -> Bool {
        minimumSeconds <= range.minimumSeconds && range.maximumSeconds <= maximumSeconds
    }
}

private enum CatalogValidationConstants {
    static let exactMatchCount = 1
    static let durations: [DurationVariant] = [.quick, .standard]
}

private enum CatalogMediaKinds {
    static let video = "video"
    static let illustration = "illustration"
    static let allowed: Set<String> = [video, illustration]
}
