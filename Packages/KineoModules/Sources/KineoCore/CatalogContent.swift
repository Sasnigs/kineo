import Foundation

/// A bundled media asset referenced by movement content.
public struct MediaReference: Equatable, Codable, Sendable {
    public let assetID: NonEmptyString
    public let kind: NonEmptyString
    public let localBundlePath: NonEmptyString
    public let captionTrackPath: NonEmptyString?
    public let transcriptKey: NonEmptyString?
    public let accessibilityDescriptionKey: NonEmptyString
    public let licenseEvidenceID: NonEmptyString?
    public let sha256: NonEmptyString

    public init(
        assetID: NonEmptyString,
        kind: NonEmptyString,
        localBundlePath: NonEmptyString,
        captionTrackPath: NonEmptyString?,
        transcriptKey: NonEmptyString?,
        accessibilityDescriptionKey: NonEmptyString,
        licenseEvidenceID: NonEmptyString?,
        sha256: NonEmptyString
    ) {
        self.assetID = assetID
        self.kind = kind
        self.localBundlePath = localBundlePath
        self.captionTrackPath = captionTrackPath
        self.transcriptKey = transcriptKey
        self.accessibilityDescriptionKey = accessibilityDescriptionKey
        self.licenseEvidenceID = licenseEvidenceID
        self.sha256 = sha256
    }
}

/// The dose applied when a user selects an authored alternative.
public enum AlternativeDosePolicy: Equatable, Codable, Sendable {
    case preserveScheduledDose
    case explicit(Dose)

    private enum CodingKeys: String, CodingKey {
        case kind
        case dose
    }

    private enum Kind: String, Codable {
        case preserveScheduledDose = "preserve_scheduled_dose"
        case explicit
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(Kind.self, forKey: .kind) {
        case .preserveScheduledDose:
            guard !values.contains(.dose) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .dose,
                    in: values,
                    debugDescription: "A preserved dose must not include an explicit dose."
                )
            }
            self = .preserveScheduledDose
        case .explicit:
            self = .explicit(try values.decode(Dose.self, forKey: .dose))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .preserveScheduledDose:
            try values.encode(Kind.preserveScheduledDose, forKey: .kind)
        case .explicit(let dose):
            try values.encode(Kind.explicit, forKey: .kind)
            try values.encode(dose, forKey: .dose)
        }
    }
}

/// A direct, authored replacement for one movement.
public struct AlternativeReference: Equatable, Codable, Sendable {
    public let movementID: CatalogID
    public let reasonCodes: Set<AlternativeReason>
    public let dosePolicy: AlternativeDosePolicy

    public init(
        movementID: CatalogID,
        reasonCodes: Set<AlternativeReason>,
        dosePolicy: AlternativeDosePolicy
    ) throws(CatalogValidationError) {
        guard !reasonCodes.isEmpty else { throw .invalidAlternative("reasonCodes") }
        self.movementID = movementID
        self.reasonCodes = reasonCodes
        self.dosePolicy = dosePolicy
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                movementID: values.decode(CatalogID.self, forKey: .movementID),
                reasonCodes: values.decode(Set<AlternativeReason>.self, forKey: .reasonCodes),
                dosePolicy: values.decode(AlternativeDosePolicy.self, forKey: .dosePolicy)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .reasonCodes,
                in: values,
                debugDescription: "Invalid alternative reference: \(error)."
            )
        }
    }
}

/// One immutable, pre-authored movement definition.
public struct MovementDefinition: Equatable, Codable, Sendable {
    public let metadata: ContentMetadata
    public let supportedAreas: Set<BodyArea>
    public let supportedLevels: Set<RoutineLevel>
    public let position: MovementPosition
    public let equipment: Set<String>
    public let instructionKey: NonEmptyString
    public let safetyCueKey: NonEmptyString
    public let media: MediaReference?
    public let spokenCueKey: NonEmptyString?
    public let alternatives: [AlternativeReference]

    public init(
        metadata: ContentMetadata,
        supportedAreas: Set<BodyArea>,
        supportedLevels: Set<RoutineLevel>,
        position: MovementPosition,
        equipment: Set<String>,
        instructionKey: NonEmptyString,
        safetyCueKey: NonEmptyString,
        media: MediaReference?,
        spokenCueKey: NonEmptyString?,
        alternatives: [AlternativeReference]
    ) throws(CatalogValidationError) {
        guard !supportedAreas.isEmpty else { throw .invalidArtifact("supportedAreas") }
        guard !supportedLevels.isEmpty else { throw .invalidArtifact("supportedLevels") }
        guard equipment.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw .invalidArtifact("equipment")
        }
        self.metadata = metadata
        self.supportedAreas = supportedAreas
        self.supportedLevels = supportedLevels
        self.position = position
        self.equipment = equipment
        self.instructionKey = instructionKey
        self.safetyCueKey = safetyCueKey
        self.media = media
        self.spokenCueKey = spokenCueKey
        self.alternatives = alternatives
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                metadata: values.decode(ContentMetadata.self, forKey: .metadata),
                supportedAreas: values.decode(Set<BodyArea>.self, forKey: .supportedAreas),
                supportedLevels: values.decode(Set<RoutineLevel>.self, forKey: .supportedLevels),
                position: values.decode(MovementPosition.self, forKey: .position),
                equipment: values.decode(Set<String>.self, forKey: .equipment),
                instructionKey: values.decode(NonEmptyString.self, forKey: .instructionKey),
                safetyCueKey: values.decode(NonEmptyString.self, forKey: .safetyCueKey),
                media: values.decodeIfPresent(MediaReference.self, forKey: .media),
                spokenCueKey: values.decodeIfPresent(NonEmptyString.self, forKey: .spokenCueKey),
                alternatives: values.decode([AlternativeReference].self, forKey: .alternatives)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .supportedAreas,
                in: values,
                debugDescription: "Invalid movement definition: \(error)."
            )
        }
    }
}

/// The allowed duration range for one replacement slot.
public struct DurationBudget: Equatable, Codable, Sendable {
    public let minimumSeconds: Int
    public let nominalSeconds: Int
    public let maximumSeconds: Int

    public init(
        minimumSeconds: Int,
        nominalSeconds: Int,
        maximumSeconds: Int
    ) throws(CatalogValidationError) {
        guard minimumSeconds > 0,
              minimumSeconds <= nominalSeconds,
              nominalSeconds <= maximumSeconds else {
            throw .invalidDuration("replacementSlot")
        }
        self.minimumSeconds = minimumSeconds
        self.nominalSeconds = nominalSeconds
        self.maximumSeconds = maximumSeconds
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                minimumSeconds: values.decode(Int.self, forKey: .minimumSeconds),
                nominalSeconds: values.decode(Int.self, forKey: .nominalSeconds),
                maximumSeconds: values.decode(Int.self, forKey: .maximumSeconds)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .nominalSeconds,
                in: values,
                debugDescription: "Invalid slot duration budget: \(error)."
            )
        }
    }
}

/// A bounded point where a reviewed secondary module may replace a default fragment.
public struct ReplacementSlot: Equatable, Codable, Sendable {
    public let slotID: CatalogID
    public let kind: SlotKind
    public let budget: DurationBudget
    public let defaultFragmentID: CatalogID
    public let allowedPositions: Set<MovementPosition>
    public let allowedEquipment: Set<String>

    public init(
        slotID: CatalogID,
        kind: SlotKind,
        budget: DurationBudget,
        defaultFragmentID: CatalogID,
        allowedPositions: Set<MovementPosition>,
        allowedEquipment: Set<String>
    ) throws(CatalogValidationError) {
        guard !allowedPositions.isEmpty else { throw .invalidArtifact("allowedPositions") }
        guard allowedEquipment.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw .invalidArtifact("allowedEquipment")
        }
        self.slotID = slotID
        self.kind = kind
        self.budget = budget
        self.defaultFragmentID = defaultFragmentID
        self.allowedPositions = allowedPositions
        self.allowedEquipment = allowedEquipment
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                slotID: values.decode(CatalogID.self, forKey: .slotID),
                kind: values.decode(SlotKind.self, forKey: .kind),
                budget: values.decode(DurationBudget.self, forKey: .budget),
                defaultFragmentID: values.decode(CatalogID.self, forKey: .defaultFragmentID),
                allowedPositions: values.decode(
                    Set<MovementPosition>.self,
                    forKey: .allowedPositions
                ),
                allowedEquipment: values.decode(Set<String>.self, forKey: .allowedEquipment)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .allowedPositions,
                in: values,
                debugDescription: "Invalid replacement slot: \(error)."
            )
        }
    }
}

/// One ordered item in an authored sequence.
public struct SequenceItem: Equatable, Codable, Sendable {
    public let itemID: CatalogID
    public let kind: SequenceItemKind
    public let movementID: CatalogID?
    public let dose: Dose?
    public let fixedSeconds: Int?
    public let slot: ReplacementSlot?

    public init(
        itemID: CatalogID,
        kind: SequenceItemKind,
        movementID: CatalogID?,
        dose: Dose?,
        fixedSeconds: Int?,
        slot: ReplacementSlot?
    ) throws(CatalogValidationError) {
        switch kind {
        case .movement:
            guard movementID != nil, dose != nil, fixedSeconds == nil, slot == nil else {
                throw .invalidSequenceItem(kind.rawValue)
            }
        case .transition, .rest:
            guard movementID == nil, dose == nil, slot == nil,
                  let fixedSeconds, fixedSeconds > 0 else {
                throw .invalidSequenceItem(kind.rawValue)
            }
        case .replacementSlot:
            guard movementID == nil, dose == nil, fixedSeconds == nil, slot != nil else {
                throw .invalidSequenceItem(kind.rawValue)
            }
        }
        self.itemID = itemID
        self.kind = kind
        self.movementID = movementID
        self.dose = dose
        self.fixedSeconds = fixedSeconds
        self.slot = slot
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                itemID: values.decode(CatalogID.self, forKey: .itemID),
                kind: values.decode(SequenceItemKind.self, forKey: .kind),
                movementID: values.decodeIfPresent(CatalogID.self, forKey: .movementID),
                dose: values.decodeIfPresent(Dose.self, forKey: .dose),
                fixedSeconds: values.decodeIfPresent(Int.self, forKey: .fixedSeconds),
                slot: values.decodeIfPresent(ReplacementSlot.self, forKey: .slot)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: values,
                debugDescription: "Invalid sequence item: \(error)."
            )
        }
    }
}

/// A default primary-only replacement fragment.
public struct RoutineFragment: Equatable, Codable, Sendable {
    public let metadata: ContentMetadata
    public let area: BodyArea
    public let level: RoutineLevel
    public let duration: DurationVariant
    public let items: [SequenceItem]

    public init(
        metadata: ContentMetadata,
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        items: [SequenceItem]
    ) throws(CatalogValidationError) {
        try SequenceArtifactRules.validate(items: items, expectedSlotCount: SequenceArtifactRules.noSlots)
        self.metadata = metadata
        self.area = area
        self.level = level
        self.duration = duration
        self.items = items
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                metadata: values.decode(ContentMetadata.self, forKey: .metadata),
                area: values.decode(BodyArea.self, forKey: .area),
                level: values.decode(RoutineLevel.self, forKey: .level),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                items: values.decode([SequenceItem].self, forKey: .items)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .items,
                in: values,
                debugDescription: "Invalid routine fragment: \(error)."
            )
        }
    }
}

/// A complete primary routine variant with one replaceable secondary slot.
public struct PrimaryTemplateVariant: Equatable, Codable, Sendable {
    public let metadata: ContentMetadata
    public let area: BodyArea
    public let level: RoutineLevel
    public let duration: DurationVariant
    public let nominalSeconds: Int
    public let items: [SequenceItem]

    public init(
        metadata: ContentMetadata,
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        nominalSeconds: Int,
        items: [SequenceItem]
    ) throws(CatalogValidationError) {
        guard nominalSeconds > 0 else { throw .invalidDuration("primaryTemplate") }
        try SequenceArtifactRules.validate(items: items, expectedSlotCount: SequenceArtifactRules.primarySlotCount)
        self.metadata = metadata
        self.area = area
        self.level = level
        self.duration = duration
        self.nominalSeconds = nominalSeconds
        self.items = items
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                metadata: values.decode(ContentMetadata.self, forKey: .metadata),
                area: values.decode(BodyArea.self, forKey: .area),
                level: values.decode(RoutineLevel.self, forKey: .level),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                nominalSeconds: values.decode(Int.self, forKey: .nominalSeconds),
                items: values.decode([SequenceItem].self, forKey: .items)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .items,
                in: values,
                debugDescription: "Invalid primary template: \(error)."
            )
        }
    }
}

/// A secondary-area module authored for one primary replacement slot.
public struct SecondaryModuleVariant: Equatable, Codable, Sendable {
    public let metadata: ContentMetadata
    public let area: BodyArea
    public let level: RoutineLevel
    public let duration: DurationVariant
    public let slotKind: SlotKind
    public let nominalSeconds: Int
    public let position: MovementPosition
    public let equipment: Set<String>
    public let items: [SequenceItem]

    public init(
        metadata: ContentMetadata,
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        slotKind: SlotKind,
        nominalSeconds: Int,
        position: MovementPosition,
        equipment: Set<String>,
        items: [SequenceItem]
    ) throws(CatalogValidationError) {
        guard nominalSeconds > 0 else { throw .invalidDuration("secondaryModule") }
        guard equipment.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw .invalidArtifact("equipment")
        }
        try SequenceArtifactRules.validate(items: items, expectedSlotCount: SequenceArtifactRules.noSlots)
        self.metadata = metadata
        self.area = area
        self.level = level
        self.duration = duration
        self.slotKind = slotKind
        self.nominalSeconds = nominalSeconds
        self.position = position
        self.equipment = equipment
        self.items = items
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                metadata: values.decode(ContentMetadata.self, forKey: .metadata),
                area: values.decode(BodyArea.self, forKey: .area),
                level: values.decode(RoutineLevel.self, forKey: .level),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                slotKind: values.decode(SlotKind.self, forKey: .slotKind),
                nominalSeconds: values.decode(Int.self, forKey: .nominalSeconds),
                position: values.decode(MovementPosition.self, forKey: .position),
                equipment: values.decode(Set<String>.self, forKey: .equipment),
                items: values.decode([SequenceItem].self, forKey: .items)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .items,
                in: values,
                debugDescription: "Invalid secondary module: \(error)."
            )
        }
    }
}

/// An explicit decision for one ordered primary-secondary combination.
public struct CompatibilityRule: Equatable, Codable, Sendable {
    public let metadata: ContentMetadata
    public let primaryArea: BodyArea
    public let secondaryArea: BodyArea
    public let level: RoutineLevel
    public let duration: DurationVariant
    public let primaryTemplateID: CatalogID
    public let slotID: CatalogID
    public let secondaryModuleID: CatalogID
    public let allowed: Bool
    public let transitionOrderReviewed: Bool
    public let duplicateMovementReviewed: Bool
    public let equipmentReviewed: Bool
    public let positionChangesReviewed: Bool
    public let cueInteractionReviewed: Bool

    public init(
        metadata: ContentMetadata,
        primaryArea: BodyArea,
        secondaryArea: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        primaryTemplateID: CatalogID,
        slotID: CatalogID,
        secondaryModuleID: CatalogID,
        allowed: Bool,
        transitionOrderReviewed: Bool,
        duplicateMovementReviewed: Bool,
        equipmentReviewed: Bool,
        positionChangesReviewed: Bool,
        cueInteractionReviewed: Bool
    ) throws(CatalogValidationError) {
        guard primaryArea != secondaryArea else { throw .invalidArtifact("compatibilityAreas") }
        self.metadata = metadata
        self.primaryArea = primaryArea
        self.secondaryArea = secondaryArea
        self.level = level
        self.duration = duration
        self.primaryTemplateID = primaryTemplateID
        self.slotID = slotID
        self.secondaryModuleID = secondaryModuleID
        self.allowed = allowed
        self.transitionOrderReviewed = transitionOrderReviewed
        self.duplicateMovementReviewed = duplicateMovementReviewed
        self.equipmentReviewed = equipmentReviewed
        self.positionChangesReviewed = positionChangesReviewed
        self.cueInteractionReviewed = cueInteractionReviewed
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                metadata: values.decode(ContentMetadata.self, forKey: .metadata),
                primaryArea: values.decode(BodyArea.self, forKey: .primaryArea),
                secondaryArea: values.decode(BodyArea.self, forKey: .secondaryArea),
                level: values.decode(RoutineLevel.self, forKey: .level),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                primaryTemplateID: values.decode(CatalogID.self, forKey: .primaryTemplateID),
                slotID: values.decode(CatalogID.self, forKey: .slotID),
                secondaryModuleID: values.decode(CatalogID.self, forKey: .secondaryModuleID),
                allowed: values.decode(Bool.self, forKey: .allowed),
                transitionOrderReviewed: values.decode(
                    Bool.self,
                    forKey: .transitionOrderReviewed
                ),
                duplicateMovementReviewed: values.decode(
                    Bool.self,
                    forKey: .duplicateMovementReviewed
                ),
                equipmentReviewed: values.decode(Bool.self, forKey: .equipmentReviewed),
                positionChangesReviewed: values.decode(
                    Bool.self,
                    forKey: .positionChangesReviewed
                ),
                cueInteractionReviewed: values.decode(
                    Bool.self,
                    forKey: .cueInteractionReviewed
                )
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .secondaryArea,
                in: values,
                debugDescription: "Invalid compatibility rule: \(error)."
            )
        }
    }

    /// Whether all mechanical compatibility checks explicitly passed.
    public var hasCompleteMechanicalReview: Bool {
        transitionOrderReviewed && duplicateMovementReviewed && equipmentReviewed &&
            positionChangesReviewed && cueInteractionReviewed
    }
}

private enum SequenceArtifactRules {
    static let noSlots = 0
    static let primarySlotCount = 1

    static func validate(
        items: [SequenceItem],
        expectedSlotCount: Int
    ) throws(CatalogValidationError) {
        guard !items.isEmpty else { throw .invalidArtifact("items") }
        guard Set(items.map(\.itemID)).count == items.count else {
            throw .invalidArtifact("duplicateItemID")
        }
        guard items.count(where: { $0.kind == .replacementSlot }) == expectedSlotCount else {
            throw .invalidArtifact("slotCount")
        }
    }
}
