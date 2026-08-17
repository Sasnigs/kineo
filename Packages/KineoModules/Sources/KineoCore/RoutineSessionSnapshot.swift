import CryptoKit
import Foundation

/// Localization keys used for non-movement routine items.
public enum RoutinePresentationLocalizationKeys {
    public static let transitionTitle = "routine.transition.title"
    public static let restTitle = "routine.rest.title"
}

/// Failures when resolving a user-selected snapshot alternative.
public enum RoutineAlternativeSelectionError: Error, Equatable, Sendable {
    case itemNotFound(CatalogID)
    case alternativeNotOffered(CatalogID)
}

/// A localized, immutable alternative offered for one scheduled movement.
public struct PresentedAlternative: Equatable, Codable, Sendable {
    public let movementID: CatalogID
    public let movementRevision: ContentRevision
    public let localizedTitle: NonEmptyString
    public let localizedInstruction: NonEmptyString
    public let localizedSafetyCue: NonEmptyString
    public let accessibleDescription: NonEmptyString
    public let mediaAssetID: NonEmptyString?
    public let scheduledDose: Dose
}

/// One localized immutable item presented during a routine session.
public struct PresentedRoutineItem: Equatable, Codable, Sendable {
    public let sourceOwnerID: CatalogID
    public let sourceOwnerRevision: ContentRevision
    public let sourceRole: ContentRole
    public let sourceArea: BodyArea
    public let itemID: CatalogID
    public let movementID: CatalogID?
    public let movementRevision: ContentRevision?
    public let localizedTitle: NonEmptyString
    public let localizedInstruction: NonEmptyString?
    public let localizedSafetyCue: NonEmptyString?
    public let accessibleDescription: NonEmptyString?
    public let mediaAssetID: NonEmptyString?
    public let scheduledDose: Dose?
    public let availableAlternatives: [PresentedAlternative]

    public init(
        sourceOwnerID: CatalogID,
        sourceOwnerRevision: ContentRevision,
        sourceRole: ContentRole,
        sourceArea: BodyArea,
        itemID: CatalogID,
        movementID: CatalogID?,
        movementRevision: ContentRevision?,
        localizedTitle: NonEmptyString,
        localizedInstruction: NonEmptyString?,
        localizedSafetyCue: NonEmptyString?,
        accessibleDescription: NonEmptyString?,
        mediaAssetID: NonEmptyString?,
        scheduledDose: Dose?,
        availableAlternatives: [PresentedAlternative]
    ) throws(CatalogValidationError) {
        let hasMovement = movementID != nil
        guard hasMovement == (movementRevision != nil),
              hasMovement == (scheduledDose != nil),
              hasMovement == (localizedInstruction != nil),
              hasMovement == (localizedSafetyCue != nil),
              hasMovement == (accessibleDescription != nil),
              hasMovement || (availableAlternatives.isEmpty && mediaAssetID == nil) else {
            throw .invalidArtifact("presentedRoutineItem")
        }
        self.sourceOwnerID = sourceOwnerID
        self.sourceOwnerRevision = sourceOwnerRevision
        self.sourceRole = sourceRole
        self.sourceArea = sourceArea
        self.itemID = itemID
        self.movementID = movementID
        self.movementRevision = movementRevision
        self.localizedTitle = localizedTitle
        self.localizedInstruction = localizedInstruction
        self.localizedSafetyCue = localizedSafetyCue
        self.accessibleDescription = accessibleDescription
        self.mediaAssetID = mediaAssetID
        self.scheduledDose = scheduledDose
        self.availableAlternatives = availableAlternatives
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                sourceOwnerID: values.decode(CatalogID.self, forKey: .sourceOwnerID),
                sourceOwnerRevision: values.decode(
                    ContentRevision.self,
                    forKey: .sourceOwnerRevision
                ),
                sourceRole: values.decode(ContentRole.self, forKey: .sourceRole),
                sourceArea: values.decode(BodyArea.self, forKey: .sourceArea),
                itemID: values.decode(CatalogID.self, forKey: .itemID),
                movementID: values.decodeIfPresent(CatalogID.self, forKey: .movementID),
                movementRevision: values.decodeIfPresent(
                    ContentRevision.self,
                    forKey: .movementRevision
                ),
                localizedTitle: values.decode(NonEmptyString.self, forKey: .localizedTitle),
                localizedInstruction: values.decodeIfPresent(
                    NonEmptyString.self,
                    forKey: .localizedInstruction
                ),
                localizedSafetyCue: values.decodeIfPresent(
                    NonEmptyString.self,
                    forKey: .localizedSafetyCue
                ),
                accessibleDescription: values.decodeIfPresent(
                    NonEmptyString.self,
                    forKey: .accessibleDescription
                ),
                mediaAssetID: values.decodeIfPresent(NonEmptyString.self, forKey: .mediaAssetID),
                scheduledDose: values.decodeIfPresent(Dose.self, forKey: .scheduledDose),
                availableAlternatives: values.decode(
                    [PresentedAlternative].self,
                    forKey: .availableAlternatives
                )
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .movementID,
                in: values,
                debugDescription: "Invalid presented routine item: \(error)."
            )
        }
    }
}

/// The complete immutable content and presentation state for one active session.
public struct RoutineSessionSnapshot: Equatable, Codable, Sendable {
    public let sessionID: RoutineSessionID
    public let decisionID: SelectionDecisionID
    public let compositionID: CompositionID
    public let catalogVersion: CatalogVersion
    public let rulesVersion: NonEmptyString
    public let fingerprint: SHA256Digest
    public let selectedLevel: RoutineLevel
    public let deliveredLevel: RoutineLevel
    public let duration: DurationVariant
    public let includedAreas: [BodyArea]
    public let notices: [NonEmptyString]
    public let presentedExplanationKeys: [NonEmptyString]
    public let presentedExplanationParameters: [[String: String]]
    public let items: [PresentedRoutineItem]
    public let createdAt: TimestampMilliseconds

    public init(
        sessionID: RoutineSessionID,
        decisionID: SelectionDecisionID,
        compositionID: CompositionID,
        catalogVersion: CatalogVersion,
        rulesVersion: NonEmptyString,
        fingerprint: SHA256Digest,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel,
        duration: DurationVariant,
        includedAreas: [BodyArea],
        notices: [NonEmptyString],
        presentedExplanationKeys: [NonEmptyString],
        presentedExplanationParameters: [[String: String]],
        items: [PresentedRoutineItem],
        createdAt: TimestampMilliseconds
    ) throws(CatalogValidationError) {
        guard !items.isEmpty,
              (BodyAreaSelectionLimits.minimumCount...BodyAreaSelectionLimits.maximumCount)
                .contains(includedAreas.count),
              Set(includedAreas).count == includedAreas.count,
              presentedExplanationKeys.count == presentedExplanationParameters.count,
              presentedExplanationParameters.allSatisfy(Self.hasNonEmptyEntries) else {
            throw .invalidArtifact("routineSessionSnapshot")
        }
        self.sessionID = sessionID
        self.decisionID = decisionID
        self.compositionID = compositionID
        self.catalogVersion = catalogVersion
        self.rulesVersion = rulesVersion
        self.fingerprint = fingerprint
        self.selectedLevel = selectedLevel
        self.deliveredLevel = deliveredLevel
        self.duration = duration
        self.includedAreas = includedAreas
        self.notices = notices
        self.presentedExplanationKeys = presentedExplanationKeys
        self.presentedExplanationParameters = presentedExplanationParameters
        self.items = items
        self.createdAt = createdAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                sessionID: values.decode(RoutineSessionID.self, forKey: .sessionID),
                decisionID: values.decode(SelectionDecisionID.self, forKey: .decisionID),
                compositionID: values.decode(CompositionID.self, forKey: .compositionID),
                catalogVersion: values.decode(CatalogVersion.self, forKey: .catalogVersion),
                rulesVersion: values.decode(NonEmptyString.self, forKey: .rulesVersion),
                fingerprint: values.decode(SHA256Digest.self, forKey: .fingerprint),
                selectedLevel: values.decode(RoutineLevel.self, forKey: .selectedLevel),
                deliveredLevel: values.decode(RoutineLevel.self, forKey: .deliveredLevel),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                includedAreas: values.decode([BodyArea].self, forKey: .includedAreas),
                notices: values.decode([NonEmptyString].self, forKey: .notices),
                presentedExplanationKeys: values.decode(
                    [NonEmptyString].self,
                    forKey: .presentedExplanationKeys
                ),
                presentedExplanationParameters: values.decode(
                    [[String: String]].self,
                    forKey: .presentedExplanationParameters
                ),
                items: values.decode([PresentedRoutineItem].self, forKey: .items),
                createdAt: values.decode(TimestampMilliseconds.self, forKey: .createdAt)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .items,
                in: values,
                debugDescription: "Invalid routine session snapshot: \(error)."
            )
        }
    }

    /// Returns an alternative only when it was frozen for the specified item.
    public func alternative(
        _ movementID: CatalogID,
        forItem itemID: CatalogID
    ) throws(RoutineAlternativeSelectionError) -> PresentedAlternative {
        guard let item = items.first(where: { $0.itemID == itemID }) else {
            throw .itemNotFound(itemID)
        }
        guard let alternative = item.availableAlternatives.first(where: {
            $0.movementID == movementID
        }) else {
            throw .alternativeNotOffered(movementID)
        }
        return alternative
    }

    /// Encodes the snapshot for durable storage with a checksum over the exact bytes.
    public func opaqueRepresentation() throws(CatalogValidationError) -> OpaqueRoutineSnapshot {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let bytes = try encoder.encode(self)
            let value = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            let checksum = try SHA256Digest(validating: value)
            return try OpaqueRoutineSnapshot(
                bytes: bytes,
                checksum: checksum,
                includedAreas: includedAreas
            )
        } catch {
            throw .invalidArtifact("snapshotEncoding")
        }
    }

    private static func hasNonEmptyEntries(_ parameters: [String: String]) -> Bool {
        parameters.allSatisfy { key, value in
            !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }
}

/// Builds immutable session presentation from one composed routine.
public enum RoutineSessionSnapshotBuilder {
    /// Resolves and freezes all user-visible movement content and alternatives.
    public static func make(
        sessionID: RoutineSessionID,
        decisionID: SelectionDecisionID,
        composition: ComposedRoutine,
        catalog: RoutineCatalog,
        resources: CatalogValidationResources,
        rulesVersion: NonEmptyString,
        notices: [NonEmptyString],
        explanationKeys: [NonEmptyString],
        explanationParameters: [[String: String]],
        createdAt: TimestampMilliseconds
    ) throws(CatalogValidationError) -> RoutineSessionSnapshot {
        guard composition.catalogVersion == catalog.catalogVersion else {
            throw .invalidArtifact("snapshotCatalogVersion")
        }
        try validateReferences(composition: composition, catalog: catalog)
        guard try composition.computedFingerprint() == composition.fingerprint else {
            throw .invalidArtifact("snapshotCompositionFingerprint")
        }
        var movementsByID = [CatalogID: MovementDefinition]()
        for movement in catalog.movements {
            guard movementsByID.updateValue(movement, forKey: movement.metadata.id) == nil else {
                throw .duplicateRecordID(movement.metadata.id)
            }
        }
        var items = [PresentedRoutineItem]()
        for item in composition.orderedItems {
            items.append(
                try presentedItem(
                    from: item,
                    movementsByID: movementsByID,
                    resources: resources
                )
            )
        }
        return try RoutineSessionSnapshot(
            sessionID: sessionID,
            decisionID: decisionID,
            compositionID: composition.compositionID,
            catalogVersion: catalog.catalogVersion,
            rulesVersion: rulesVersion,
            fingerprint: composition.fingerprint,
            selectedLevel: composition.selectedLevel,
            deliveredLevel: composition.deliveredLevel,
            duration: composition.duration,
            includedAreas: composition.includedAreas,
            notices: notices,
            presentedExplanationKeys: explanationKeys,
            presentedExplanationParameters: explanationParameters,
            items: items,
            createdAt: createdAt
        )
    }

    private static func presentedItem(
        from composed: ComposedSequenceItem,
        movementsByID: [CatalogID: MovementDefinition],
        resources: CatalogValidationResources
    ) throws(CatalogValidationError) -> PresentedRoutineItem {
        let item = composed.item
        guard let movementID = item.movementID else {
            let key = item.kind == .rest ?
                RoutinePresentationLocalizationKeys.restTitle :
                RoutinePresentationLocalizationKeys.transitionTitle
            return try PresentedRoutineItem(
                sourceOwnerID: composed.sourceOwner.id,
                sourceOwnerRevision: composed.sourceOwner.revision,
                sourceRole: composed.sourceRole,
                sourceArea: composed.sourceArea,
                itemID: item.itemID,
                movementID: nil,
                movementRevision: nil,
                localizedTitle: localized(key, resources: resources),
                localizedInstruction: nil,
                localizedSafetyCue: nil,
                accessibleDescription: nil,
                mediaAssetID: nil,
                scheduledDose: nil,
                availableAlternatives: []
            )
        }
        guard let movement = movementsByID[movementID], let dose = item.dose else {
            throw .missingReference(movementID)
        }
        var alternatives = [PresentedAlternative]()
        for reference in movement.alternatives {
            guard let alternative = movementsByID[reference.movementID] else {
                throw .missingReference(reference.movementID)
            }
            let scheduledDose: Dose
            switch reference.dosePolicy {
            case .preserveScheduledDose:
                scheduledDose = dose
            case .explicit(let authoredDose):
                scheduledDose = authoredDose
            }
            alternatives.append(PresentedAlternative(
                movementID: alternative.metadata.id,
                movementRevision: alternative.metadata.revision,
                localizedTitle: try localized(
                    alternative.metadata.displayNameKey.rawValue,
                    resources: resources
                ),
                localizedInstruction: try localized(
                    alternative.instructionKey.rawValue,
                    resources: resources
                ),
                localizedSafetyCue: try localized(
                    alternative.safetyCueKey.rawValue,
                    resources: resources
                ),
                accessibleDescription: try localized(
                    accessibilityKey(for: alternative),
                    resources: resources
                ),
                mediaAssetID: try mediaAssetID(for: alternative),
                scheduledDose: scheduledDose
            ))
        }
        return try PresentedRoutineItem(
            sourceOwnerID: composed.sourceOwner.id,
            sourceOwnerRevision: composed.sourceOwner.revision,
            sourceRole: composed.sourceRole,
            sourceArea: composed.sourceArea,
            itemID: item.itemID,
            movementID: movement.metadata.id,
            movementRevision: movement.metadata.revision,
            localizedTitle: localized(movement.metadata.displayNameKey.rawValue, resources: resources),
            localizedInstruction: localized(movement.instructionKey.rawValue, resources: resources),
            localizedSafetyCue: localized(movement.safetyCueKey.rawValue, resources: resources),
            accessibleDescription: localized(
                accessibilityKey(for: movement),
                resources: resources
            ),
            mediaAssetID: try mediaAssetID(for: movement),
            scheduledDose: dose,
            availableAlternatives: alternatives
        )
    }

    private static func validateReferences(
        composition: ComposedRoutine,
        catalog: RoutineCatalog
    ) throws(CatalogValidationError) {
        guard contains(composition.primaryTemplate, in: catalog.primaryTemplates) else {
            throw .missingReference(composition.primaryTemplate.id)
        }
        if let module = composition.secondaryModule,
           !contains(module, in: catalog.secondaryModules) {
            throw .missingReference(module.id)
        }
        if let rule = composition.compatibilityRule,
           !catalog.compatibilityRules.contains(where: {
               $0.metadata.id == rule.id && $0.metadata.revision == rule.revision
           }) {
            throw .missingReference(rule.id)
        }
        for item in composition.orderedItems {
            let exists: Bool
            switch item.sourceRole {
            case .primaryTemplate:
                exists = catalog.primaryTemplates.contains {
                    $0.metadata.id == item.sourceOwner.id &&
                        $0.metadata.revision == item.sourceOwner.revision &&
                        $0.area == item.sourceArea
                }
            case .secondaryModule:
                exists = catalog.secondaryModules.contains {
                    $0.metadata.id == item.sourceOwner.id &&
                        $0.metadata.revision == item.sourceOwner.revision &&
                        $0.area == item.sourceArea
                }
            case .fragment:
                exists = catalog.fragments.contains {
                    $0.metadata.id == item.sourceOwner.id &&
                        $0.metadata.revision == item.sourceOwner.revision &&
                        $0.area == item.sourceArea
                }
            case .movement:
                exists = false
            }
            guard exists else { throw .missingReference(item.sourceOwner.id) }
        }
    }

    private static func contains(
        _ reference: VersionedContentReference,
        in records: [PrimaryTemplateVariant]
    ) -> Bool {
        records.contains {
            $0.metadata.id == reference.id && $0.metadata.revision == reference.revision
        }
    }

    private static func contains(
        _ reference: VersionedContentReference,
        in records: [SecondaryModuleVariant]
    ) -> Bool {
        records.contains {
            $0.metadata.id == reference.id && $0.metadata.revision == reference.revision
        }
    }

    private static func accessibilityKey(for movement: MovementDefinition) -> String {
        movement.media?.accessibilityDescriptionKey.rawValue ??
            movement.metadata.accessibilityDescriptionKey?.rawValue ??
            movement.metadata.displayNameKey.rawValue
    }

    private static func mediaAssetID(
        for movement: MovementDefinition
    ) throws(CatalogValidationError) -> NonEmptyString? {
        guard let media = movement.media else { return nil }
        return try nonEmpty(media.assetID.rawValue)
    }

    private static func localized(
        _ key: String,
        resources: CatalogValidationResources
    ) throws(CatalogValidationError) -> NonEmptyString {
        guard let value = resources.localizedStrings[key] else {
            throw .missingLocalization(key)
        }
        return try nonEmpty(value)
    }

    private static func nonEmpty(_ value: String) throws(CatalogValidationError) -> NonEmptyString {
        do {
            return try NonEmptyString(validating: value)
        } catch {
            throw .invalidArtifact("snapshotPresentation")
        }
    }
}
