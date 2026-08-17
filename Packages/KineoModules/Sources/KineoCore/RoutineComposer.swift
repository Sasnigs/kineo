import Foundation

/// A deterministic request to compose content for one selected plan revision.
public struct CatalogCompositionRequest: Equatable, Codable, Sendable {
    public let decisionID: SelectionDecisionID
    public let primaryArea: BodyArea
    public let secondaryArea: BodyArea?
    public let selectedLevel: RoutineLevel
    public let duration: DurationVariant
    public let catalogVersion: CatalogVersion
    public let buildChannel: BuildChannel

    public init(
        decisionID: SelectionDecisionID,
        primaryArea: BodyArea,
        secondaryArea: BodyArea?,
        selectedLevel: RoutineLevel,
        duration: DurationVariant,
        catalogVersion: CatalogVersion,
        buildChannel: BuildChannel
    ) throws(CatalogValidationError) {
        guard secondaryArea != primaryArea else {
            throw .invalidCompositionRequest("duplicateArea")
        }
        self.decisionID = decisionID
        self.primaryArea = primaryArea
        self.secondaryArea = secondaryArea
        self.selectedLevel = selectedLevel
        self.duration = duration
        self.catalogVersion = catalogVersion
        self.buildChannel = buildChannel
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                decisionID: values.decode(SelectionDecisionID.self, forKey: .decisionID),
                primaryArea: values.decode(BodyArea.self, forKey: .primaryArea),
                secondaryArea: values.decodeIfPresent(BodyArea.self, forKey: .secondaryArea),
                selectedLevel: values.decode(RoutineLevel.self, forKey: .selectedLevel),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                catalogVersion: values.decode(CatalogVersion.self, forKey: .catalogVersion),
                buildChannel: values.decode(BuildChannel.self, forKey: .buildChannel)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .secondaryArea,
                in: values,
                debugDescription: "Invalid composition request: \(error)."
            )
        }
    }
}

/// The catalog path used to produce a composed routine.
public enum CompositionStatus: String, Codable, Sendable {
    case exact
    case primaryOnly = "primary_only"
    case gentlerFallback = "gentler_fallback"
    case gentlerFallbackPrimaryOnly = "gentler_fallback_primary_only"
}

/// The reason no bounded routine could be produced.
public enum CompositionUnavailableReason: String, Codable, Sendable {
    case invalidCatalog = "invalid_catalog"
    case catalogVersionMismatch = "catalog_version_mismatch"
    case noApprovedPrimaryContent = "no_approved_primary_content"
}

/// An immutable reference to one exact catalog revision.
public struct VersionedContentReference: Equatable, Codable, Sendable {
    public let id: CatalogID
    public let revision: ContentRevision

    public init(id: CatalogID, revision: ContentRevision) {
        self.id = id
        self.revision = revision
    }
}

/// One resolved sequence item and its authored source.
public struct ComposedSequenceItem: Equatable, Codable, Sendable {
    public let sourceOwner: VersionedContentReference
    public let sourceRole: ContentRole
    public let sourceArea: BodyArea
    public let item: SequenceItem

    public init(
        sourceOwner: VersionedContentReference,
        sourceRole: ContentRole,
        sourceArea: BodyArea,
        item: SequenceItem
    ) throws(CatalogValidationError) {
        guard item.kind != .replacementSlot else {
            throw .invalidArtifact("unresolvedCompositionSlot")
        }
        self.sourceOwner = sourceOwner
        self.sourceRole = sourceRole
        self.sourceArea = sourceArea
        self.item = item
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                sourceOwner: values.decode(
                    VersionedContentReference.self,
                    forKey: .sourceOwner
                ),
                sourceRole: values.decode(ContentRole.self, forKey: .sourceRole),
                sourceArea: values.decode(BodyArea.self, forKey: .sourceArea),
                item: values.decode(SequenceItem.self, forKey: .item)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .item,
                in: values,
                debugDescription: "Invalid composed sequence item: \(error)."
            )
        }
    }
}

/// A complete immutable routine assembled only from validated catalog records.
public struct ComposedRoutine: Equatable, Codable, Sendable {
    public let compositionID: CompositionID
    public let catalogVersion: CatalogVersion
    public let status: CompositionStatus
    public let selectedLevel: RoutineLevel
    public let deliveredLevel: RoutineLevel
    public let duration: DurationVariant
    public let includedAreas: [BodyArea]
    public let omittedArea: BodyArea?
    public let omissionReason: OmissionReason?
    public let primaryTemplate: VersionedContentReference
    public let secondaryModule: VersionedContentReference?
    public let compatibilityRule: VersionedContentReference?
    public let orderedItems: [ComposedSequenceItem]
    public let nominalSeconds: Int
    public let minimumPathSeconds: Int
    public let maximumPathSeconds: Int
    public let fingerprint: SHA256Digest

    public init(
        compositionID: CompositionID,
        catalogVersion: CatalogVersion,
        status: CompositionStatus,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel,
        duration: DurationVariant,
        includedAreas: [BodyArea],
        omittedArea: BodyArea?,
        omissionReason: OmissionReason?,
        primaryTemplate: VersionedContentReference,
        secondaryModule: VersionedContentReference?,
        compatibilityRule: VersionedContentReference?,
        orderedItems: [ComposedSequenceItem],
        nominalSeconds: Int,
        minimumPathSeconds: Int,
        maximumPathSeconds: Int,
        fingerprint: SHA256Digest
    ) throws(CatalogValidationError) {
        guard !includedAreas.isEmpty,
              includedAreas.count <= BodyAreaSelectionLimits.maximumCount,
              Set(includedAreas).count == includedAreas.count,
              !orderedItems.isEmpty,
              deliveredLevel <= selectedLevel,
              minimumPathSeconds > 0,
              minimumPathSeconds <= nominalSeconds,
              nominalSeconds <= maximumPathSeconds else {
            throw .invalidArtifact("composedRoutine")
        }
        switch status {
        case .exact:
            guard deliveredLevel == selectedLevel,
                  omittedArea == nil,
                  omissionReason == nil else {
                throw .invalidArtifact("compositionStatus")
            }
        case .gentlerFallback:
            guard deliveredLevel < selectedLevel,
                  omittedArea == nil,
                  omissionReason == nil else {
                throw .invalidArtifact("compositionStatus")
            }
        case .primaryOnly:
            guard deliveredLevel == selectedLevel,
                  includedAreas.count == CatalogCompositionLimits.primaryOnlyAreaCount,
                  let omittedArea,
                  !includedAreas.contains(omittedArea),
                  omissionReason != nil,
                  secondaryModule == nil,
                  compatibilityRule == nil else {
                throw .invalidArtifact("compositionOmission")
            }
        case .gentlerFallbackPrimaryOnly:
            guard deliveredLevel < selectedLevel,
                  includedAreas.count == CatalogCompositionLimits.primaryOnlyAreaCount,
                  let omittedArea,
                  !includedAreas.contains(omittedArea),
                  omissionReason != nil,
                  secondaryModule == nil,
                  compatibilityRule == nil else {
                throw .invalidArtifact("compositionOmission")
            }
        }
        guard (secondaryModule == nil) == (compatibilityRule == nil) else {
            throw .invalidArtifact("compositionReferences")
        }
        if secondaryModule != nil {
            guard includedAreas.count == BodyAreaSelectionLimits.maximumCount else {
                throw .invalidArtifact("compositionReferences")
            }
        }
        let computedFingerprint = try Self.makeFingerprint(
            catalogVersion: catalogVersion,
            status: status,
            selectedLevel: selectedLevel,
            deliveredLevel: deliveredLevel,
            duration: duration,
            includedAreas: includedAreas,
            omittedArea: omittedArea,
            omissionReason: omissionReason,
            primaryTemplate: primaryTemplate,
            secondaryModule: secondaryModule,
            compatibilityRule: compatibilityRule,
            orderedItems: orderedItems,
            nominalSeconds: nominalSeconds,
            minimumPathSeconds: minimumPathSeconds,
            maximumPathSeconds: maximumPathSeconds
        )
        guard computedFingerprint == fingerprint else {
            throw .invalidArtifact("compositionFingerprint")
        }
        self.compositionID = compositionID
        self.catalogVersion = catalogVersion
        self.status = status
        self.selectedLevel = selectedLevel
        self.deliveredLevel = deliveredLevel
        self.duration = duration
        self.includedAreas = includedAreas
        self.omittedArea = omittedArea
        self.omissionReason = omissionReason
        self.primaryTemplate = primaryTemplate
        self.secondaryModule = secondaryModule
        self.compatibilityRule = compatibilityRule
        self.orderedItems = orderedItems
        self.nominalSeconds = nominalSeconds
        self.minimumPathSeconds = minimumPathSeconds
        self.maximumPathSeconds = maximumPathSeconds
        self.fingerprint = fingerprint
    }

    /// Recomputes the deterministic content fingerprint for integrity checks.
    public func computedFingerprint() throws(CatalogValidationError) -> SHA256Digest {
        try Self.makeFingerprint(
            catalogVersion: catalogVersion,
            status: status,
            selectedLevel: selectedLevel,
            deliveredLevel: deliveredLevel,
            duration: duration,
            includedAreas: includedAreas,
            omittedArea: omittedArea,
            omissionReason: omissionReason,
            primaryTemplate: primaryTemplate,
            secondaryModule: secondaryModule,
            compatibilityRule: compatibilityRule,
            orderedItems: orderedItems,
            nominalSeconds: nominalSeconds,
            minimumPathSeconds: minimumPathSeconds,
            maximumPathSeconds: maximumPathSeconds
        )
    }

    static func makeFingerprint(
        catalogVersion: CatalogVersion,
        status: CompositionStatus,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel,
        duration: DurationVariant,
        includedAreas: [BodyArea],
        omittedArea: BodyArea?,
        omissionReason: OmissionReason?,
        primaryTemplate: VersionedContentReference,
        secondaryModule: VersionedContentReference?,
        compatibilityRule: VersionedContentReference?,
        orderedItems: [ComposedSequenceItem],
        nominalSeconds: Int,
        minimumPathSeconds: Int,
        maximumPathSeconds: Int
    ) throws(CatalogValidationError) -> SHA256Digest {
        let payload = ComposedRoutineFingerprintPayload(
            catalogVersion: catalogVersion,
            status: status,
            selectedLevel: selectedLevel,
            deliveredLevel: deliveredLevel,
            duration: duration,
            includedAreas: includedAreas,
            omittedArea: omittedArea,
            omissionReason: omissionReason,
            primaryTemplate: primaryTemplate,
            secondaryModule: secondaryModule,
            compatibilityRule: compatibilityRule,
            orderedItems: orderedItems,
            nominalSeconds: nominalSeconds,
            minimumPathSeconds: minimumPathSeconds,
            maximumPathSeconds: maximumPathSeconds
        )
        return try CanonicalSHA256Fingerprint.make(
            for: payload,
            sortingStringArrays: false
        )
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                compositionID: values.decode(CompositionID.self, forKey: .compositionID),
                catalogVersion: values.decode(CatalogVersion.self, forKey: .catalogVersion),
                status: values.decode(CompositionStatus.self, forKey: .status),
                selectedLevel: values.decode(RoutineLevel.self, forKey: .selectedLevel),
                deliveredLevel: values.decode(RoutineLevel.self, forKey: .deliveredLevel),
                duration: values.decode(DurationVariant.self, forKey: .duration),
                includedAreas: values.decode([BodyArea].self, forKey: .includedAreas),
                omittedArea: values.decodeIfPresent(BodyArea.self, forKey: .omittedArea),
                omissionReason: values.decodeIfPresent(
                    OmissionReason.self,
                    forKey: .omissionReason
                ),
                primaryTemplate: values.decode(
                    VersionedContentReference.self,
                    forKey: .primaryTemplate
                ),
                secondaryModule: values.decodeIfPresent(
                    VersionedContentReference.self,
                    forKey: .secondaryModule
                ),
                compatibilityRule: values.decodeIfPresent(
                    VersionedContentReference.self,
                    forKey: .compatibilityRule
                ),
                orderedItems: values.decode([ComposedSequenceItem].self, forKey: .orderedItems),
                nominalSeconds: values.decode(Int.self, forKey: .nominalSeconds),
                minimumPathSeconds: values.decode(Int.self, forKey: .minimumPathSeconds),
                maximumPathSeconds: values.decode(Int.self, forKey: .maximumPathSeconds),
                fingerprint: values.decode(SHA256Digest.self, forKey: .fingerprint)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: values,
                debugDescription: "Invalid composed routine: \(error)."
            )
        }
    }
}

/// Either a complete composed routine or a precise unavailable state.
public enum CatalogCompositionResult: Equatable, Sendable {
    case composed(ComposedRoutine)
    case unavailable(CompositionUnavailableReason)
}

/// Deterministic bounded routine composition over an installed catalog.
public enum RoutineComposer {
    /// Composes a routine or returns a precise fail-closed unavailable result.
    public static func compose(
        request: CatalogCompositionRequest,
        catalog: RoutineCatalog,
        resources: CatalogValidationResources,
        compositionID: CompositionID = CompositionID(UUID())
    ) -> CatalogCompositionResult {
        do {
            try CatalogValidator.validate(
                catalog,
                for: request.buildChannel,
                resources: resources
            )
        } catch let error {
            if error.invalidatesEntireCatalog {
                return .unavailable(.invalidCatalog)
            }
            // Artifact-local failures remain eligible for the documented ordered fallbacks.
        }

        guard request.catalogVersion == catalog.catalogVersion else {
            return .unavailable(.catalogVersionMismatch)
        }

        for candidateLevel in gentlerLevels(from: request.selectedLevel) {
            guard let primary = exactPrimary(
                area: request.primaryArea,
                level: candidateLevel,
                duration: request.duration,
                channel: request.buildChannel,
                catalog: catalog
            ) else {
                continue
            }

            if let secondaryArea = request.secondaryArea,
               let composed = composeSecondary(
                   request: request,
                   candidateLevel: candidateLevel,
                   primary: primary,
                   secondaryArea: secondaryArea,
                   catalog: catalog,
                   resources: resources,
                   compositionID: compositionID
               ) {
                return .composed(composed)
            }

            let omissionReason = secondaryOmissionReason(
                request: request,
                candidateLevel: candidateLevel,
                catalog: catalog
            )
            if let primaryOnly = composePrimaryOnly(
                request: request,
                candidateLevel: candidateLevel,
                primary: primary,
                catalog: catalog,
                resources: resources,
                compositionID: compositionID,
                omissionReason: omissionReason
            ) {
                return .composed(primaryOnly)
            }
        }
        return .unavailable(.noApprovedPrimaryContent)
    }

    private static func composeSecondary(
        request: CatalogCompositionRequest,
        candidateLevel: RoutineLevel,
        primary: PrimaryTemplateVariant,
        secondaryArea: BodyArea,
        catalog: RoutineCatalog,
        resources: CatalogValidationResources,
        compositionID: CompositionID
    ) -> ComposedRoutine? {
        guard let module = exactModule(
            area: secondaryArea,
            level: candidateLevel,
            duration: request.duration,
            channel: request.buildChannel,
            catalog: catalog
        ),
        let rule = exactAllowedRule(
            primary: primary,
            module: module,
            level: candidateLevel,
            duration: request.duration,
            channel: request.buildChannel,
            catalog: catalog
        ) else {
            return nil
        }
        guard candidateIsValid(
            primary: primary,
            module: module,
            rule: rule,
            catalog: catalog,
            channel: request.buildChannel,
            resources: resources
        ) else {
            return nil
        }
        do {
            let items = try resolvedItems(primary: primary, replacement: module, catalog: catalog)
            let status: CompositionStatus = candidateLevel == request.selectedLevel ?
                .exact : .gentlerFallback
            return try makeRoutine(
                compositionID: compositionID,
                status: status,
                request: request,
                deliveredLevel: candidateLevel,
                includedAreas: [request.primaryArea, secondaryArea],
                omittedArea: nil,
                omissionReason: nil,
                primary: primary,
                module: module,
                rule: rule,
                items: items,
                catalog: catalog
            )
        } catch {
            // A candidate-local projection failure follows the documented fallback path.
            return nil
        }
    }

    private static func composePrimaryOnly(
        request: CatalogCompositionRequest,
        candidateLevel: RoutineLevel,
        primary: PrimaryTemplateVariant,
        catalog: RoutineCatalog,
        resources: CatalogValidationResources,
        compositionID: CompositionID,
        omissionReason: OmissionReason?
    ) -> ComposedRoutine? {
        guard candidateIsValid(
            primary: primary,
            module: nil,
            rule: nil,
            catalog: catalog,
            channel: request.buildChannel,
            resources: resources
        ) else {
            return nil
        }
        do {
            let items = try resolvedItems(primary: primary, replacement: nil, catalog: catalog)
            let isGentler = candidateLevel != request.selectedLevel
            let status: CompositionStatus
            if request.secondaryArea == nil {
                status = isGentler ? .gentlerFallback : .exact
            } else {
                status = isGentler ? .gentlerFallbackPrimaryOnly : .primaryOnly
            }
            return try makeRoutine(
                compositionID: compositionID,
                status: status,
                request: request,
                deliveredLevel: candidateLevel,
                includedAreas: [request.primaryArea],
                omittedArea: request.secondaryArea,
                omissionReason: omissionReason,
                primary: primary,
                module: nil,
                rule: nil,
                items: items,
                catalog: catalog
            )
        } catch {
            return nil
        }
    }

    private static func makeRoutine(
        compositionID: CompositionID,
        status: CompositionStatus,
        request: CatalogCompositionRequest,
        deliveredLevel: RoutineLevel,
        includedAreas: [BodyArea],
        omittedArea: BodyArea?,
        omissionReason: OmissionReason?,
        primary: PrimaryTemplateVariant,
        module: SecondaryModuleVariant?,
        rule: CompatibilityRule?,
        items: [ComposedSequenceItem],
        catalog: RoutineCatalog
    ) throws(CatalogValidationError) -> ComposedRoutine {
        let range = try pathRange(items: items, catalog: catalog)
        let nominal = try nominalSeconds(items: items)
        let primaryReference = reference(primary.metadata)
        let moduleReference = module.map { reference($0.metadata) }
        let ruleReference = rule.map { reference($0.metadata) }
        let fingerprint = try ComposedRoutine.makeFingerprint(
            catalogVersion: catalog.catalogVersion,
            status: status,
            selectedLevel: request.selectedLevel,
            deliveredLevel: deliveredLevel,
            duration: request.duration,
            includedAreas: includedAreas,
            omittedArea: omittedArea,
            omissionReason: omissionReason,
            primaryTemplate: primaryReference,
            secondaryModule: moduleReference,
            compatibilityRule: ruleReference,
            orderedItems: items,
            nominalSeconds: nominal,
            minimumPathSeconds: range.minimumSeconds,
            maximumPathSeconds: range.maximumSeconds
        )
        return try ComposedRoutine(
            compositionID: compositionID,
            catalogVersion: catalog.catalogVersion,
            status: status,
            selectedLevel: request.selectedLevel,
            deliveredLevel: deliveredLevel,
            duration: request.duration,
            includedAreas: includedAreas,
            omittedArea: omittedArea,
            omissionReason: omissionReason,
            primaryTemplate: primaryReference,
            secondaryModule: moduleReference,
            compatibilityRule: ruleReference,
            orderedItems: items,
            nominalSeconds: nominal,
            minimumPathSeconds: range.minimumSeconds,
            maximumPathSeconds: range.maximumSeconds,
            fingerprint: fingerprint
        )
    }

    private static func candidateIsValid(
        primary: PrimaryTemplateVariant,
        module: SecondaryModuleVariant?,
        rule: CompatibilityRule?,
        catalog: RoutineCatalog,
        channel: BuildChannel,
        resources: CatalogValidationResources
    ) -> Bool {
        do {
            let fragmentIDs = Set(primary.items.compactMap { $0.slot?.defaultFragmentID })
            let fragments = catalog.fragments.filter { fragmentIDs.contains($0.metadata.id) }
            let sequenceItems = primary.items + fragments.flatMap(\.items) + (module?.items ?? [])
            let movements = movementClosure(for: sequenceItems, catalog: catalog)
            let candidate = try RoutineCatalog.makeSigned(
                schemaVersion: catalog.schemaVersion,
                catalogVersion: catalog.catalogVersion,
                createdAt: catalog.createdAt,
                buildEligibility: catalog.buildEligibility,
                durationPolicies: catalog.durationPolicies,
                movements: movements,
                fragments: fragments,
                primaryTemplates: [primary],
                secondaryModules: module.map { [$0] } ?? [],
                compatibilityRules: rule.map { [$0] } ?? []
            )
            try CatalogValidator.validate(candidate, for: channel, resources: resources)
            return true
        } catch {
            // A candidate-local validation failure makes only that candidate unavailable.
            return false
        }
    }

    private static func movementClosure(
        for items: [SequenceItem],
        catalog: RoutineCatalog
    ) -> [MovementDefinition] {
        let byID = movementsByID(in: catalog)
        var pending = items.compactMap(\.movementID)
        var included = Set<CatalogID>()
        while let id = pending.popLast() {
            guard included.insert(id).inserted, let movement = byID[id] else { continue }
            pending.append(contentsOf: movement.alternatives.map(\.movementID))
        }
        return catalog.movements.filter { included.contains($0.metadata.id) }
    }

    private static func resolvedItems(
        primary: PrimaryTemplateVariant,
        replacement: SecondaryModuleVariant?,
        catalog: RoutineCatalog
    ) throws(CatalogValidationError) -> [ComposedSequenceItem] {
        var result = [ComposedSequenceItem]()
        for item in primary.items {
            guard let slot = item.slot else {
                result.append(
                    try ComposedSequenceItem(
                        sourceOwner: reference(primary.metadata),
                        sourceRole: .primaryTemplate,
                        sourceArea: primary.area,
                        item: item
                    )
                )
                continue
            }
            if let replacement {
                for moduleItem in replacement.items {
                    result.append(
                        try ComposedSequenceItem(
                            sourceOwner: reference(replacement.metadata),
                            sourceRole: .secondaryModule,
                            sourceArea: replacement.area,
                            item: moduleItem
                        )
                    )
                }
            } else {
                guard let fragment = catalog.fragments.first(where: {
                    $0.metadata.id == slot.defaultFragmentID
                }) else {
                    throw .missingReference(slot.defaultFragmentID)
                }
                for fragmentItem in fragment.items {
                    result.append(
                        try ComposedSequenceItem(
                            sourceOwner: reference(fragment.metadata),
                            sourceRole: .fragment,
                            sourceArea: fragment.area,
                            item: fragmentItem
                        )
                    )
                }
            }
        }
        return result
    }

    private static func exactPrimary(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        channel: BuildChannel,
        catalog: RoutineCatalog
    ) -> PrimaryTemplateVariant? {
        catalog.primaryTemplates.first {
            $0.area == area && $0.level == level && $0.duration == duration &&
                $0.metadata.isEligible(for: channel)
        }
    }

    private static func exactModule(
        area: BodyArea,
        level: RoutineLevel,
        duration: DurationVariant,
        channel: BuildChannel,
        catalog: RoutineCatalog
    ) -> SecondaryModuleVariant? {
        catalog.secondaryModules.first {
            $0.area == area && $0.level == level && $0.duration == duration &&
                $0.metadata.isEligible(for: channel)
        }
    }

    private static func exactAllowedRule(
        primary: PrimaryTemplateVariant,
        module: SecondaryModuleVariant,
        level: RoutineLevel,
        duration: DurationVariant,
        channel: BuildChannel,
        catalog: RoutineCatalog
    ) -> CompatibilityRule? {
        catalog.compatibilityRules.first {
            $0.primaryTemplateID == primary.metadata.id &&
                $0.secondaryModuleID == module.metadata.id &&
                $0.level == level &&
                $0.duration == duration &&
                $0.allowed &&
                $0.hasCompleteMechanicalReview &&
                $0.metadata.isEligible(for: channel)
        }
    }

    private static func secondaryOmissionReason(
        request: CatalogCompositionRequest,
        candidateLevel: RoutineLevel,
        catalog: RoutineCatalog
    ) -> OmissionReason? {
        guard let secondaryArea = request.secondaryArea else { return nil }
        guard exactModule(
            area: secondaryArea,
            level: candidateLevel,
            duration: request.duration,
            channel: request.buildChannel,
            catalog: catalog
        ) != nil else {
            return .contentUnavailable
        }
        return .catalogIncompatible
    }

    private static func gentlerLevels(from selectedLevel: RoutineLevel) -> [RoutineLevel] {
        switch selectedLevel {
        case .active: [.active, .balanced, .gentle]
        case .balanced: [.balanced, .gentle]
        case .gentle: [.gentle]
        }
    }

    private static func reference(_ metadata: ContentMetadata) -> VersionedContentReference {
        VersionedContentReference(id: metadata.id, revision: metadata.revision)
    }

    private static func nominalSeconds(
        items: [ComposedSequenceItem]
    ) throws(CatalogValidationError) -> Int {
        var seconds = 0
        for composed in items {
            guard let value = composed.item.dose?.estimatedSeconds ?? composed.item.fixedSeconds else {
                throw .invalidSequenceItem(composed.item.kind.rawValue)
            }
            seconds = try adding(seconds, value)
        }
        return seconds
    }

    private static func pathRange(
        items: [ComposedSequenceItem],
        catalog: RoutineCatalog
    ) throws(CatalogValidationError) -> CompositionPathRange {
        let movementsByID = movementsByID(in: catalog)
        var total = CompositionPathRange.zero
        for composed in items {
            let item = composed.item
            if let fixedSeconds = item.fixedSeconds {
                total = try total.adding(
                    CompositionPathRange(
                        minimumSeconds: fixedSeconds,
                        maximumSeconds: fixedSeconds
                    )
                )
                continue
            }
            guard let movementID = item.movementID,
                  let movement = movementsByID[movementID],
                  let dose = item.dose else {
                throw .invalidSequenceItem(item.kind.rawValue)
            }
            var alternatives = [dose.estimatedSeconds]
            alternatives.append(contentsOf: movement.alternatives.map {
                switch $0.dosePolicy {
                case .preserveScheduledDose: dose.estimatedSeconds
                case .explicit(let alternativeDose): alternativeDose.estimatedSeconds
                }
            })
            guard let minimum = alternatives.min(), let maximum = alternatives.max() else {
                throw .invalidDuration(item.itemID.rawValue)
            }
            total = try total.adding(
                CompositionPathRange(minimumSeconds: minimum, maximumSeconds: maximum)
            )
        }
        return total
    }

    private static func movementsByID(
        in catalog: RoutineCatalog
    ) -> [CatalogID: MovementDefinition] {
        var result = [CatalogID: MovementDefinition]()
        for movement in catalog.movements where result[movement.metadata.id] == nil {
            result[movement.metadata.id] = movement
        }
        return result
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

private struct ComposedRoutineFingerprintPayload: Encodable {
    let catalogVersion: CatalogVersion
    let status: CompositionStatus
    let selectedLevel: RoutineLevel
    let deliveredLevel: RoutineLevel
    let duration: DurationVariant
    let includedAreas: [BodyArea]
    let omittedArea: BodyArea?
    let omissionReason: OmissionReason?
    let primaryTemplate: VersionedContentReference
    let secondaryModule: VersionedContentReference?
    let compatibilityRule: VersionedContentReference?
    let orderedItems: [ComposedSequenceItem]
    let nominalSeconds: Int
    let minimumPathSeconds: Int
    let maximumPathSeconds: Int
}

private struct CompositionPathRange {
    static let zero = Self(minimumSeconds: 0, maximumSeconds: 0)

    let minimumSeconds: Int
    let maximumSeconds: Int

    func adding(_ other: Self) throws(CatalogValidationError) -> Self {
        let (minimum, minimumOverflow) = minimumSeconds.addingReportingOverflow(other.minimumSeconds)
        let (maximum, maximumOverflow) = maximumSeconds.addingReportingOverflow(other.maximumSeconds)
        guard !minimumOverflow, !maximumOverflow else { throw .invalidDuration("overflow") }
        return Self(minimumSeconds: minimum, maximumSeconds: maximum)
    }
}

private enum CatalogCompositionLimits {
    static let primaryOnlyAreaCount = 1
}

private extension CatalogValidationError {
    var invalidatesEntireCatalog: Bool {
        switch self {
        case .unsupportedSchemaVersion,
             .ineligibleCatalog,
             .manifestFingerprintMismatch,
             .duplicateRecordID,
             .duplicateVariant,
             .missingDurationPolicy,
             .ineligibleRecord,
             .invalidCatalogVersion,
             .invalidIdentifier,
             .invalidRevision,
             .invalidMetadata,
             .invalidArtifact:
            true
        case .invalidDuration,
             .invalidDose,
             .invalidAlternative,
             .invalidSequenceItem,
             .missingReference,
             .missingLocalization,
             .missingAsset,
             .assetFingerprintMismatch,
             .invalidMedia,
             .alternativeCycle,
             .incompatibleContent,
             .invalidCompositionRequest:
            false
        }
    }
}
