import CryptoKit
import Foundation

/// Deterministic internal-only content used to exercise catalog mechanics.
public enum PrototypeRoutineCatalog {
    /// Creates the complete signed prototype catalog.
    public static func make() throws(CatalogValidationError) -> RoutineCatalog {
        let movements = try makeMovements()
        let variants = try makeVariants()
        return try RoutineCatalog.makeSigned(
            catalogVersion: CatalogVersion(validating: PrototypeCatalogIdentity.version),
            createdAt: TimestampMilliseconds(rawValue: PrototypeCatalogIdentity.createdAtMilliseconds),
            buildEligibility: [.internalPrototype],
            durationPolicies: try makeDurationPolicies(),
            movements: movements,
            fragments: variants.fragments,
            primaryTemplates: variants.primaryTemplates,
            secondaryModules: variants.secondaryModules,
            compatibilityRules: try makeCompatibilityRules()
        )
    }

    /// The localization values required by the prototype catalog.
    public static func localizedStrings() throws(CatalogValidationError) -> [String: String] {
        var strings = [String: String]()
        strings[PrototypeCatalogCopy.mediaAccessibilityKey] = PrototypeCatalogCopy.mediaAccessibility
        strings[PrototypeCatalogCopy.instructionKey] = PrototypeCatalogCopy.instruction
        strings[PrototypeCatalogCopy.safetyCueKey] = PrototypeCatalogCopy.safetyCue

        for area in BodyArea.allCases {
            for ordinal in PrototypeCatalogShape.movementOrdinals {
                strings[movementTitleKey(area: area, kind: .base, ordinal: ordinal)] =
                    "Prototype movement \(ordinal)"
                strings[movementTitleKey(area: area, kind: .alternative, ordinal: ordinal)] =
                    "Prototype alternative \(ordinal)"
            }
        }
        for area in BodyArea.allCases {
            for level in RoutineLevel.allCases {
                for duration in PrototypeCatalogShape.durations {
                    strings[fragmentDisplayKey(area: area, level: level, duration: duration)] =
                        PrototypeCatalogCopy.contentLabel
                    strings[primaryDisplayKey(area: area, level: level, duration: duration)] =
                        PrototypeCatalogCopy.contentLabel
                    strings[moduleDisplayKey(area: area, level: level, duration: duration)] =
                        PrototypeCatalogCopy.contentLabel
                }
            }
        }
        for primaryArea in BodyArea.allCases {
            for secondaryArea in BodyArea.allCases where secondaryArea != primaryArea {
                for level in RoutineLevel.allCases {
                    for duration in PrototypeCatalogShape.durations {
                        strings[
                            ruleDisplayKey(
                                primaryArea: primaryArea,
                                secondaryArea: secondaryArea,
                                level: level,
                                duration: duration
                            )
                        ] = PrototypeCatalogCopy.contentLabel
                    }
                }
            }
        }
        return strings
    }

    /// The expected installed-asset digest keyed by bundle-relative path.
    public static func assetDigests() throws(CatalogValidationError) -> [String: SHA256Digest] {
        [PrototypeCatalogMedia.bundlePath: try placeholderAssetDigest()]
    }

    private static func makeMovements() throws(CatalogValidationError) -> [MovementDefinition] {
        var movements = [MovementDefinition]()
        for area in BodyArea.allCases {
            for ordinal in PrototypeCatalogShape.movementOrdinals {
                let alternativeID = try movementID(
                    area: area,
                    kind: .alternative,
                    ordinal: ordinal
                )
                let alternative = try MovementDefinition(
                    metadata: metadata(
                        id: alternativeID,
                        displayNameKey: movementTitleKey(
                            area: area,
                            kind: .alternative,
                            ordinal: ordinal
                        )
                    ),
                    supportedAreas: [area],
                    supportedLevels: Set(RoutineLevel.allCases),
                    position: .prototypeAbstract,
                    equipment: [],
                    instructionKey: text(PrototypeCatalogCopy.instructionKey),
                    safetyCueKey: text(PrototypeCatalogCopy.safetyCueKey),
                    media: try placeholderMedia(),
                    spokenCueKey: nil,
                    alternatives: []
                )
                let base = try MovementDefinition(
                    metadata: metadata(
                        id: movementID(area: area, kind: .base, ordinal: ordinal),
                        displayNameKey: movementTitleKey(
                            area: area,
                            kind: .base,
                            ordinal: ordinal
                        )
                    ),
                    supportedAreas: [area],
                    supportedLevels: Set(RoutineLevel.allCases),
                    position: .prototypeAbstract,
                    equipment: [],
                    instructionKey: text(PrototypeCatalogCopy.instructionKey),
                    safetyCueKey: text(PrototypeCatalogCopy.safetyCueKey),
                    media: try placeholderMedia(),
                    spokenCueKey: nil,
                    alternatives: [
                        try AlternativeReference(
                            movementID: alternativeID,
                            reasonCodes: PrototypeCatalogShape.alternativeReasons,
                            dosePolicy: .preserveScheduledDose
                        )
                    ]
                )
                movements.append(base)
                movements.append(alternative)
            }
        }
        return movements
    }

    private static func makeVariants() throws(CatalogValidationError) -> CatalogVariants {
        var fragments = [RoutineFragment]()
        var primaryTemplates = [PrimaryTemplateVariant]()
        var secondaryModules = [SecondaryModuleVariant]()
        for area in BodyArea.allCases {
            for level in RoutineLevel.allCases {
                for duration in PrototypeCatalogShape.durations {
                    let fragment = try makeFragment(area: area, level: level, duration: duration)
                    fragments.append(fragment)
                    primaryTemplates.append(
                        try makePrimary(
                            area: area,
                            level: level,
                            duration: duration,
                            fragmentID: fragment.metadata.id
                        )
                    )
                    secondaryModules.append(
                        try makeModule(area: area, level: level, duration: duration)
                    )
                }
            }
        }
        return CatalogVariants(
            fragments: fragments,
            primaryTemplates: primaryTemplates,
            secondaryModules: secondaryModules
        )
    }

    private static func makeFragment(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> RoutineFragment {
        let id = try fragmentID(area: area, level: level, duration: duration)
        return try RoutineFragment(
            metadata: metadata(
                id: id,
                displayNameKey: fragmentDisplayKey(area: area, level: level, duration: duration)
            ),
            area: area,
            level: level,
            duration: duration,
            items: [
                try movementItem(
                    ownerID: id,
                    ordinal: PrototypeCatalogShape.firstItemOrdinal,
                    movementOrdinal: PrototypeCatalogShape.defaultFragmentMovementOrdinal,
                    area: area,
                    seconds: slotSeconds(for: duration)
                )
            ]
        )
    }

    private static func makePrimary(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        fragmentID: CatalogID
    ) throws(CatalogValidationError) -> PrimaryTemplateVariant {
        let id = try primaryID(area: area, level: level, duration: duration)
        let items: [SequenceItem]
        switch duration {
        case .quick:
            items = try quickPrimaryItems(ownerID: id, area: area, fragmentID: fragmentID)
        case .standard:
            items = try standardPrimaryItems(ownerID: id, area: area, fragmentID: fragmentID)
        }
        return try PrimaryTemplateVariant(
            metadata: metadata(
                id: id,
                displayNameKey: primaryDisplayKey(area: area, level: level, duration: duration)
            ),
            area: area,
            level: level,
            duration: duration,
            nominalSeconds: nominalSeconds(for: duration),
            items: items
        )
    }

    private static func makeModule(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> SecondaryModuleVariant {
        let id = try moduleID(area: area, level: level, duration: duration)
        return try SecondaryModuleVariant(
            metadata: metadata(
                id: id,
                displayNameKey: moduleDisplayKey(area: area, level: level, duration: duration)
            ),
            area: area,
            level: level,
            duration: duration,
            slotKind: .secondaryFocus,
            nominalSeconds: slotSeconds(for: duration),
            position: .prototypeAbstract,
            equipment: [],
            items: [
                try movementItem(
                    ownerID: id,
                    ordinal: PrototypeCatalogShape.firstItemOrdinal,
                    movementOrdinal: PrototypeCatalogShape.secondaryModuleMovementOrdinal,
                    area: area,
                    seconds: slotSeconds(for: duration)
                )
            ]
        )
    }

    private static func makeCompatibilityRules() throws(CatalogValidationError) -> [CompatibilityRule] {
        var rules = [CompatibilityRule]()
        for primaryArea in BodyArea.allCases {
            for secondaryArea in BodyArea.allCases where secondaryArea != primaryArea {
                for level in RoutineLevel.allCases {
                    for duration in PrototypeCatalogShape.durations {
                        let primaryID = try primaryID(
                            area: primaryArea,
                            level: level,
                            duration: duration
                        )
                        rules.append(
                            try CompatibilityRule(
                                metadata: metadata(
                                    id: ruleID(
                                        primaryArea: primaryArea,
                                        secondaryArea: secondaryArea,
                                        level: level,
                                        duration: duration
                                    ),
                                    displayNameKey: ruleDisplayKey(
                                        primaryArea: primaryArea,
                                        secondaryArea: secondaryArea,
                                        level: level,
                                        duration: duration
                                    )
                                ),
                                primaryArea: primaryArea,
                                secondaryArea: secondaryArea,
                                level: level,
                                duration: duration,
                                primaryTemplateID: primaryID,
                                slotID: slotID(primaryID: primaryID),
                                secondaryModuleID: moduleID(
                                    area: secondaryArea,
                                    level: level,
                                    duration: duration
                                ),
                                allowed: true,
                                transitionOrderReviewed: true,
                                duplicateMovementReviewed: true,
                                equipmentReviewed: true,
                                positionChangesReviewed: true,
                                cueInteractionReviewed: true
                            )
                        )
                    }
                }
            }
        }
        return rules
    }

    private static func quickPrimaryItems(
        ownerID: CatalogID,
        area: BodyArea,
        fragmentID: CatalogID
    ) throws(CatalogValidationError) -> [SequenceItem] {
        [
            try movementItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.firstMovement,
                movementOrdinal: PrototypePrimaryMovementOrdinal.first,
                area: area,
                seconds: PrototypeCatalogTiming.quickFirstMovementSeconds
            ),
            try transitionItem(ownerID: ownerID, ordinal: PrototypePrimaryItemOrdinal.firstTransition),
            try slotItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.slot,
                fragmentID: fragmentID,
                duration: .quick
            ),
            try transitionItem(ownerID: ownerID, ordinal: PrototypePrimaryItemOrdinal.secondTransition),
            try movementItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.secondMovement,
                movementOrdinal: PrototypePrimaryMovementOrdinal.second,
                area: area,
                seconds: PrototypeCatalogTiming.quickSecondMovementSeconds
            )
        ]
    }

    private static func standardPrimaryItems(
        ownerID: CatalogID,
        area: BodyArea,
        fragmentID: CatalogID
    ) throws(CatalogValidationError) -> [SequenceItem] {
        [
            try movementItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.firstMovement,
                movementOrdinal: PrototypePrimaryMovementOrdinal.first,
                area: area,
                seconds: PrototypeCatalogTiming.standardFirstMovementSeconds
            ),
            try transitionItem(ownerID: ownerID, ordinal: PrototypePrimaryItemOrdinal.firstTransition),
            try slotItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.slot,
                fragmentID: fragmentID,
                duration: .standard
            ),
            try transitionItem(ownerID: ownerID, ordinal: PrototypePrimaryItemOrdinal.secondTransition),
            try movementItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.secondMovement,
                movementOrdinal: PrototypePrimaryMovementOrdinal.second,
                area: area,
                seconds: PrototypeCatalogTiming.standardSecondMovementSeconds
            ),
            try transitionItem(ownerID: ownerID, ordinal: PrototypePrimaryItemOrdinal.thirdTransition),
            try movementItem(
                ownerID: ownerID,
                ordinal: PrototypePrimaryItemOrdinal.thirdMovement,
                movementOrdinal: PrototypePrimaryMovementOrdinal.third,
                area: area,
                seconds: PrototypeCatalogTiming.standardThirdMovementSeconds
            )
        ]
    }

    private static func movementItem(
        ownerID: CatalogID,
        ordinal: Int,
        movementOrdinal: Int,
        area: BodyArea,
        seconds: Int
    ) throws(CatalogValidationError) -> SequenceItem {
        try SequenceItem(
            itemID: itemID(ownerID: ownerID, ordinal: ordinal),
            kind: .movement,
            movementID: movementID(area: area, kind: .base, ordinal: movementOrdinal),
            dose: Dose(
                kind: .timed,
                activeSeconds: seconds,
                repetitionCount: nil,
                estimatedSeconds: seconds
            ),
            fixedSeconds: nil,
            slot: nil
        )
    }

    private static func transitionItem(
        ownerID: CatalogID,
        ordinal: Int
    ) throws(CatalogValidationError) -> SequenceItem {
        try SequenceItem(
            itemID: itemID(ownerID: ownerID, ordinal: ordinal),
            kind: .transition,
            movementID: nil,
            dose: nil,
            fixedSeconds: PrototypeCatalogTiming.transitionSeconds,
            slot: nil
        )
    }

    private static func slotItem(
        ownerID: CatalogID,
        ordinal: Int,
        fragmentID: CatalogID,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> SequenceItem {
        let seconds = slotSeconds(for: duration)
        return try SequenceItem(
            itemID: itemID(ownerID: ownerID, ordinal: ordinal),
            kind: .replacementSlot,
            movementID: nil,
            dose: nil,
            fixedSeconds: nil,
            slot: ReplacementSlot(
                slotID: slotID(primaryID: ownerID),
                kind: .secondaryFocus,
                budget: DurationBudget(
                    minimumSeconds: seconds,
                    nominalSeconds: seconds,
                    maximumSeconds: seconds
                ),
                defaultFragmentID: fragmentID,
                allowedPositions: [.prototypeAbstract],
                allowedEquipment: []
            )
        )
    }

    private static func makeDurationPolicies() throws(CatalogValidationError) -> [DurationPolicy] {
        [
            try DurationPolicy(
                variant: .quick,
                nominalSeconds: PrototypeCatalogDurations.quickNominalSeconds,
                minimumSeconds: PrototypeCatalogDurations.quickMinimumSeconds,
                maximumSeconds: PrototypeCatalogDurations.quickMaximumSeconds
            ),
            try DurationPolicy(
                variant: .standard,
                nominalSeconds: PrototypeCatalogDurations.standardNominalSeconds,
                minimumSeconds: PrototypeCatalogDurations.standardMinimumSeconds,
                maximumSeconds: PrototypeCatalogDurations.standardMaximumSeconds
            )
        ]
    }

    private static func placeholderMedia() throws(CatalogValidationError) -> MediaReference {
        MediaReference(
            assetID: try text(PrototypeCatalogMedia.assetID),
            kind: try text(PrototypeCatalogMedia.kind),
            localBundlePath: try text(PrototypeCatalogMedia.bundlePath),
            captionTrackPath: nil,
            transcriptKey: nil,
            accessibilityDescriptionKey: try text(PrototypeCatalogCopy.mediaAccessibilityKey),
            licenseEvidenceID: nil,
            sha256: try placeholderAssetDigest()
        )
    }

    private static func placeholderAssetDigest() throws(CatalogValidationError) -> SHA256Digest {
        let bytes = Data(PrototypeCatalogMedia.placeholderBytes.utf8)
        let value = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        do {
            return try SHA256Digest(validating: value)
        } catch {
            throw .invalidArtifact("prototypeAssetDigest")
        }
    }

    private static func metadata(
        id: CatalogID,
        displayNameKey: String
    ) throws(CatalogValidationError) -> ContentMetadata {
        try ContentMetadata(
            id: id,
            revision: ContentRevision(validating: PrototypeCatalogIdentity.contentRevision),
            reviewStatus: .prototypePlaceholder,
            locale: PrototypeCatalogIdentity.locale,
            displayNameKey: text(displayNameKey),
            accessibilityDescriptionKey: text(PrototypeCatalogCopy.mediaAccessibilityKey),
            contentOwner: text(PrototypeCatalogIdentity.contentOwner),
            reviewedBy: nil,
            reviewedAt: nil,
            reviewEvidenceID: nil,
            intendedBuilds: [.internalPrototype]
        )
    }

    private static func text(_ value: String) throws(CatalogValidationError) -> NonEmptyString {
        do {
            return try NonEmptyString(validating: value)
        } catch {
            throw .invalidArtifact("prototypeText")
        }
    }

    private static func movementID(
        area: BodyArea,
        kind: PrototypeMovementKind,
        ordinal: Int
    ) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(
            validating: "kineo.prototype.movement.\(areaSlug(area)).\(kind.rawValue).\(ordinal).v1"
        )
    }

    private static func primaryID(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(
            validating: "kineo.primary.\(areaSlug(area)).\(level.rawValue).\(duration.rawValue).v1"
        )
    }

    private static func moduleID(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(
            validating: "kineo.secondary.\(areaSlug(area)).\(level.rawValue).\(duration.rawValue).v1"
        )
    }

    private static func fragmentID(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(
            validating: "kineo.fragment.\(areaSlug(area)).\(level.rawValue).\(duration.rawValue).default.v1"
        )
    }

    private static func ruleID(
        primaryArea: BodyArea,
        secondaryArea: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(
            validating: "kineo.compat.\(areaSlug(primaryArea)).\(areaSlug(secondaryArea)).\(level.rawValue).\(duration.rawValue).v1"
        )
    }

    private static func itemID(
        ownerID: CatalogID,
        ordinal: Int
    ) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(validating: "\(ownerID.rawValue).item.\(ordinal)")
    }

    private static func slotID(primaryID: CatalogID) throws(CatalogValidationError) -> CatalogID {
        try CatalogID(validating: "\(primaryID.rawValue).slot.secondary-focus")
    }

    private static func movementTitleKey(
        area: BodyArea,
        kind: PrototypeMovementKind,
        ordinal: Int
    ) -> String {
        "prototype.movement.\(areaSlug(area)).\(kind.rawValue).\(ordinal).title"
    }

    private static func fragmentDisplayKey(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) -> String {
        "prototype.fragment.\(areaSlug(area)).\(level.rawValue).\(duration.rawValue).title"
    }

    private static func primaryDisplayKey(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) -> String {
        "prototype.primary.\(areaSlug(area)).\(level.rawValue).\(duration.rawValue).title"
    }

    private static func moduleDisplayKey(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) -> String {
        "prototype.secondary.\(areaSlug(area)).\(level.rawValue).\(duration.rawValue).title"
    }

    private static func ruleDisplayKey(
        primaryArea: BodyArea,
        secondaryArea: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant
    ) -> String {
        "prototype.compat.\(areaSlug(primaryArea)).\(areaSlug(secondaryArea)).\(level.rawValue).\(duration.rawValue).title"
    }

    private static func areaSlug(_ area: BodyArea) -> String {
        switch area {
        case .neck: "neck"
        case .upperMidBack: "upper-mid-back"
        case .lowerBack: "lower-back"
        }
    }

    private static func nominalSeconds(for duration: DurationVariant) -> Int {
        switch duration {
        case .quick: PrototypeCatalogDurations.quickNominalSeconds
        case .standard: PrototypeCatalogDurations.standardNominalSeconds
        }
    }

    private static func slotSeconds(for duration: DurationVariant) -> Int {
        switch duration {
        case .quick: PrototypeCatalogTiming.quickSlotSeconds
        case .standard: PrototypeCatalogTiming.standardSlotSeconds
        }
    }
}

private struct CatalogVariants {
    let fragments: [RoutineFragment]
    let primaryTemplates: [PrimaryTemplateVariant]
    let secondaryModules: [SecondaryModuleVariant]
}

private enum PrototypeMovementKind: String {
    case base
    case alternative
}

private enum PrototypeCatalogIdentity {
    static let version = "0.1.0"
    static let createdAtMilliseconds: Int64 = 1_754_524_800_000
    static let contentRevision = 1
    static let locale = "en-US"
    static let contentOwner = "Kineo prototype"
}

private enum PrototypeCatalogShape {
    static let movementOrdinals = 1...5
    static let firstItemOrdinal = 1
    static let defaultFragmentMovementOrdinal = 4
    static let secondaryModuleMovementOrdinal = 5
    static let durations: [DurationVariant] = [.quick, .standard]
    static let alternativeReasons: Set<AlternativeReason> = [
        .uncomfortable,
        .unclear,
        .notEnoughSpace,
        .userPreference
    ]
}

private enum PrototypeCatalogTiming {
    static let transitionSeconds = 15
    static let quickFirstMovementSeconds = 60
    static let quickSlotSeconds = 120
    static let quickSecondMovementSeconds = 90
    static let standardFirstMovementSeconds = 120
    static let standardSlotSeconds = 240
    static let standardSecondMovementSeconds = 120
    static let standardThirdMovementSeconds = 75
}

private enum PrototypePrimaryItemOrdinal {
    static let firstMovement = 1
    static let firstTransition = 2
    static let slot = 3
    static let secondTransition = 4
    static let secondMovement = 5
    static let thirdTransition = 6
    static let thirdMovement = 7
}

private enum PrototypePrimaryMovementOrdinal {
    static let first = 1
    static let second = 2
    static let third = 3
}

private enum PrototypeCatalogCopy {
    static let contentLabel = "Prototype content"
    static let instructionKey = "prototype.movement.instruction"
    static let instruction = "Prototype instruction placeholder. Production guidance is not included."
    static let safetyCueKey = "prototype.movement.safety-cue"
    static let safetyCue = "Prototype safety cue placeholder."
    static let mediaAccessibilityKey = "prototype.media.accessibility-description"
    static let mediaAccessibility = "Non-instructional prototype media placeholder."
}

private enum PrototypeCatalogMedia {
    static let assetID = "kineo.prototype.media.placeholder.v1"
    static let kind = "illustration"
    static let bundlePath = "PrototypeContent/prototype-placeholder.svg"
    static let placeholderBytes = "Prototype content"
}
