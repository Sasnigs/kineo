import Foundation
import KineoCore
import Testing

@Suite("Routine composer")
struct RoutineComposerTests {
    @Test("Every single-area prototype request composes exactly and deterministically")
    func exactSingleAreaMatrix() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        for area in BodyArea.allCases {
            for level in RoutineLevel.allCases {
                for duration in ComposerFixture.durations {
                    let request = try compositionRequest(
                        primaryArea: area,
                        secondaryArea: nil,
                        level: level,
                        duration: duration,
                        catalog: catalog
                    )
                    let first = try composed(
                        request: request,
                        catalog: catalog,
                        compositionID: compositionID(ComposerFixture.firstCompositionNumber)
                    )
                    let second = try composed(
                        request: request,
                        catalog: catalog,
                        compositionID: compositionID(ComposerFixture.secondCompositionNumber)
                    )

                    #expect(first.status == .exact)
                    #expect(first.selectedLevel == level)
                    #expect(first.deliveredLevel == level)
                    #expect(first.duration == duration)
                    #expect(first.includedAreas == [area])
                    #expect(first.omittedArea == nil)
                    #expect(first.orderedItems.allSatisfy { $0.item.kind != .replacementSlot })
                    #expect(first.nominalSeconds == expectedNominal(for: duration))
                    #expect(first.minimumPathSeconds <= first.nominalSeconds)
                    #expect(first.nominalSeconds <= first.maximumPathSeconds)
                    #expect(first.orderedItems == second.orderedItems)
                    #expect(first.fingerprint == second.fingerprint)
                    #expect(first.compositionID != second.compositionID)
                }
            }
        }
    }

    @Test("Every ordered two-area prototype request replaces one slot exactly")
    func exactTwoAreaMatrix() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        for primaryArea in BodyArea.allCases {
            for secondaryArea in BodyArea.allCases where secondaryArea != primaryArea {
                for level in RoutineLevel.allCases {
                    for duration in ComposerFixture.durations {
                        let routine = try composed(
                            request: compositionRequest(
                                primaryArea: primaryArea,
                                secondaryArea: secondaryArea,
                                level: level,
                                duration: duration,
                                catalog: catalog
                            ),
                            catalog: catalog
                        )

                        #expect(routine.status == .exact)
                        #expect(routine.includedAreas == [primaryArea, secondaryArea])
                        #expect(routine.omittedArea == nil)
                        #expect(routine.secondaryModule != nil)
                        #expect(routine.compatibilityRule != nil)
                        #expect(routine.nominalSeconds == expectedNominal(for: duration))
                        #expect(
                            routine.orderedItems.count {
                                $0.sourceRole == .secondaryModule &&
                                    $0.sourceArea == secondaryArea
                            } == ComposerFixture.secondaryItemCount
                        )
                        #expect(routine.orderedItems.allSatisfy { $0.item.kind != .replacementSlot })
                    }
                }
            }
        }
    }

    @Test("Missing or denied secondary content falls back to the exact primary")
    func primaryOnlyFallbacks() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let request = try compositionRequest(
            primaryArea: .neck,
            secondaryArea: .lowerBack,
            level: .balanced,
            duration: .quick,
            catalog: catalog
        )
        let matchingModule = try #require(catalog.secondaryModules.first {
            $0.area == .lowerBack && $0.level == .balanced && $0.duration == .quick
        })
        let withoutModule = try signed(
            catalog,
            secondaryModules: catalog.secondaryModules.filter {
                $0.metadata.id != matchingModule.metadata.id
            }
        )
        let missingModuleRoutine = try composed(request: request, catalog: withoutModule)
        #expect(missingModuleRoutine.status == .primaryOnly)
        #expect(missingModuleRoutine.omittedArea == .lowerBack)
        #expect(missingModuleRoutine.omissionReason == .contentUnavailable)

        let matchingRule = try #require(catalog.compatibilityRules.first {
            $0.primaryArea == .neck && $0.secondaryArea == .lowerBack &&
                $0.level == .balanced && $0.duration == .quick
        })
        let withoutRule = try signed(
            catalog,
            compatibilityRules: catalog.compatibilityRules.filter {
                $0.metadata.id != matchingRule.metadata.id
            }
        )
        let missingRuleRoutine = try composed(request: request, catalog: withoutRule)
        #expect(missingRuleRoutine.status == .primaryOnly)
        #expect(missingRuleRoutine.omissionReason == .catalogIncompatible)

        let deniedRule = try compatibilityRule(from: matchingRule, allowed: false)
        let deniedCatalog = try signed(
            catalog,
            compatibilityRules: catalog.compatibilityRules.map {
                $0.metadata.id == matchingRule.metadata.id ? deniedRule : $0
            }
        )
        let deniedRoutine = try composed(request: request, catalog: deniedCatalog)
        #expect(deniedRoutine.status == .primaryOnly)
        #expect(deniedRoutine.omissionReason == .catalogIncompatible)
    }

    @Test("An invalid secondary composition falls back without weakening the primary")
    func invalidSecondaryCompositionFallsBack() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let module = try #require(catalog.secondaryModules.first {
            $0.area == .lowerBack && $0.level == .gentle && $0.duration == .quick
        })
        let incompatibleModule = try SecondaryModuleVariant(
            metadata: module.metadata,
            area: module.area,
            level: module.level,
            duration: module.duration,
            slotKind: module.slotKind,
            nominalSeconds: module.nominalSeconds,
            position: module.position,
            equipment: [ComposerFixture.unapprovedEquipment],
            items: module.items
        )
        let mutated = try signed(
            catalog,
            secondaryModules: catalog.secondaryModules.map {
                $0.metadata.id == module.metadata.id ? incompatibleModule : $0
            }
        )
        let routine = try composed(
            request: compositionRequest(
                primaryArea: .neck,
                secondaryArea: .lowerBack,
                level: .gentle,
                duration: .quick,
                catalog: mutated
            ),
            catalog: mutated
        )

        #expect(routine.status == .primaryOnly)
        #expect(routine.deliveredLevel == .gentle)
        #expect(routine.omissionReason == .catalogIncompatible)
    }

    @Test("Incomplete review evidence and an over-budget module cannot enter a routine")
    func reviewAndBudgetFailuresFallBack() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let request = try compositionRequest(
            primaryArea: .neck,
            secondaryArea: .lowerBack,
            level: .gentle,
            duration: .quick,
            catalog: catalog
        )
        let rule = try #require(catalog.compatibilityRules.first {
            $0.primaryArea == .neck && $0.secondaryArea == .lowerBack &&
                $0.level == .gentle && $0.duration == .quick
        })
        let incompletelyReviewedRule = try CompatibilityRule(
            metadata: rule.metadata,
            primaryArea: rule.primaryArea,
            secondaryArea: rule.secondaryArea,
            level: rule.level,
            duration: rule.duration,
            primaryTemplateID: rule.primaryTemplateID,
            slotID: rule.slotID,
            secondaryModuleID: rule.secondaryModuleID,
            allowed: rule.allowed,
            transitionOrderReviewed: false,
            duplicateMovementReviewed: rule.duplicateMovementReviewed,
            equipmentReviewed: rule.equipmentReviewed,
            positionChangesReviewed: rule.positionChangesReviewed,
            cueInteractionReviewed: rule.cueInteractionReviewed
        )
        let incompleteReviewCatalog = try signed(
            catalog,
            compatibilityRules: catalog.compatibilityRules.map {
                $0.metadata.id == rule.metadata.id ? incompletelyReviewedRule : $0
            }
        )
        let incompleteReviewRoutine = try composed(
            request: request,
            catalog: incompleteReviewCatalog
        )
        #expect(incompleteReviewRoutine.status == .primaryOnly)
        #expect(incompleteReviewRoutine.omissionReason == .catalogIncompatible)

        let module = try #require(catalog.secondaryModules.first {
            $0.metadata.id == rule.secondaryModuleID
        })
        let originalItem = try #require(module.items.first)
        let originalDose = try #require(originalItem.dose)
        let overBudgetSeconds = module.nominalSeconds + ComposerFixture.budgetOverflowSeconds
        let overBudgetDose = try Dose(
            kind: originalDose.kind,
            activeSeconds: overBudgetSeconds,
            repetitionCount: originalDose.repetitionCount,
            estimatedSeconds: overBudgetSeconds
        )
        let overBudgetItem = try SequenceItem(
            itemID: originalItem.itemID,
            kind: originalItem.kind,
            movementID: originalItem.movementID,
            dose: overBudgetDose,
            fixedSeconds: originalItem.fixedSeconds,
            slot: originalItem.slot
        )
        let overBudgetModule = try SecondaryModuleVariant(
            metadata: module.metadata,
            area: module.area,
            level: module.level,
            duration: module.duration,
            slotKind: module.slotKind,
            nominalSeconds: overBudgetSeconds,
            position: module.position,
            equipment: module.equipment,
            items: [overBudgetItem]
        )
        let overBudgetCatalog = try signed(
            catalog,
            secondaryModules: catalog.secondaryModules.map {
                $0.metadata.id == module.metadata.id ? overBudgetModule : $0
            }
        )
        let overBudgetRoutine = try composed(request: request, catalog: overBudgetCatalog)
        #expect(overBudgetRoutine.status == .primaryOnly)
        #expect(overBudgetRoutine.omissionReason == .catalogIncompatible)
    }

    @Test("Missing primary content searches only gentler levels at the requested duration")
    func gentlerFallbackOrder() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let withoutActive = try signed(
            catalog,
            primaryTemplates: catalog.primaryTemplates.filter {
                !($0.area == .neck && $0.level == .active && $0.duration == .quick)
            }
        )
        let gentler = try composed(
            request: compositionRequest(
                primaryArea: .neck,
                secondaryArea: nil,
                level: .active,
                duration: .quick,
                catalog: withoutActive
            ),
            catalog: withoutActive
        )
        #expect(gentler.status == .gentlerFallback)
        #expect(gentler.selectedLevel == .active)
        #expect(gentler.deliveredLevel == .balanced)

        let withoutQuick = try signed(
            catalog,
            primaryTemplates: catalog.primaryTemplates.filter {
                !($0.area == .neck && $0.duration == .quick)
            }
        )
        let quickResult = RoutineComposer.compose(
            request: try compositionRequest(
                primaryArea: .neck,
                secondaryArea: nil,
                level: .active,
                duration: .quick,
                catalog: withoutQuick
            ),
            catalog: withoutQuick,
            resources: try resources()
        )
        #expect(quickResult == .unavailable(.noApprovedPrimaryContent))
    }

    @Test("No primary and version mismatch return precise unavailable states")
    func unavailableStates() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let noNeckPrimary = try signed(
            catalog,
            primaryTemplates: catalog.primaryTemplates.filter { $0.area != .neck }
        )
        let request = try compositionRequest(
            primaryArea: .neck,
            secondaryArea: nil,
            level: .gentle,
            duration: .standard,
            catalog: noNeckPrimary
        )
        #expect(
            RoutineComposer.compose(
                request: request,
                catalog: noNeckPrimary,
                resources: try resources()
            ) == .unavailable(.noApprovedPrimaryContent)
        )

        let mismatchedRequest = try CatalogCompositionRequest(
            decisionID: decisionID(),
            primaryArea: .neck,
            secondaryArea: nil,
            selectedLevel: .gentle,
            duration: .standard,
            catalogVersion: CatalogVersion(validating: "9.9.9"),
            buildChannel: .internalPrototype
        )
        #expect(
            RoutineComposer.compose(
                request: mismatchedRequest,
                catalog: catalog,
                resources: try resources()
            ) == .unavailable(.catalogVersionMismatch)
        )
    }

    @Test("Ambiguous eligible variants invalidate the whole catalog")
    func duplicatePrimaryInvalidatesCatalog() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let original = try #require(catalog.primaryTemplates.first)
        let duplicate = try PrimaryTemplateVariant(
            metadata: duplicateMetadata(original.metadata),
            area: original.area,
            level: original.level,
            duration: original.duration,
            nominalSeconds: original.nominalSeconds,
            items: original.items
        )
        let mutated = try signed(
            catalog,
            primaryTemplates: catalog.primaryTemplates + [duplicate]
        )
        let result = RoutineComposer.compose(
            request: try compositionRequest(
                primaryArea: original.area,
                secondaryArea: nil,
                level: original.level,
                duration: original.duration,
                catalog: mutated
            ),
            catalog: mutated,
            resources: try resources()
        )

        #expect(result == .unavailable(.invalidCatalog))
    }

    @Test("Composition requests and decoded routines revalidate their invariants")
    func decodingRevalidatesComposition() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        #expect(throws: CatalogValidationError.invalidCompositionRequest("duplicateArea")) {
            try CatalogCompositionRequest(
                decisionID: decisionID(),
                primaryArea: .neck,
                secondaryArea: .neck,
                selectedLevel: .gentle,
                duration: .quick,
                catalogVersion: catalog.catalogVersion,
                buildChannel: .internalPrototype
            )
        }

        let routine = try composed(
            request: compositionRequest(
                primaryArea: .neck,
                secondaryArea: nil,
                level: .gentle,
                duration: .quick,
                catalog: catalog
            ),
            catalog: catalog
        )
        let encoded = try JSONEncoder().encode(routine)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object["deliveredLevel"] = RoutineLevel.active.rawValue
        let invalid = try JSONSerialization.data(withJSONObject: object)

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(ComposedRoutine.self, from: invalid)
        }
    }

    private func composed(
        request: CatalogCompositionRequest,
        catalog: RoutineCatalog,
        compositionID: CompositionID? = nil
    ) throws -> ComposedRoutine {
        let result: CatalogCompositionResult
        if let compositionID {
            result = RoutineComposer.compose(
                request: request,
                catalog: catalog,
                resources: try resources(),
                compositionID: compositionID
            )
        } else {
            result = RoutineComposer.compose(
                request: request,
                catalog: catalog,
                resources: try resources()
            )
        }
        guard case .composed(let routine) = result else {
            Issue.record("Expected a composed routine, received \(result).")
            throw ComposerFixtureError.expectedRoutine
        }
        return routine
    }

    private func compositionRequest(
        primaryArea: BodyArea,
        secondaryArea: BodyArea?,
        level: RoutineLevel,
        duration: DurationVariant,
        catalog: RoutineCatalog
    ) throws -> CatalogCompositionRequest {
        try CatalogCompositionRequest(
            decisionID: decisionID(),
            primaryArea: primaryArea,
            secondaryArea: secondaryArea,
            selectedLevel: level,
            duration: duration,
            catalogVersion: catalog.catalogVersion,
            buildChannel: .internalPrototype
        )
    }

    private func decisionID() throws -> SelectionDecisionID {
        try SelectionDecisionID(validating: ComposerFixture.decisionID)
    }

    private func compositionID(_ number: Int) throws -> CompositionID {
        try CompositionID(
            validating: String(
                format: ComposerFixture.compositionIDFormat,
                number
            )
        )
    }

    private func resources() throws -> CatalogValidationResources {
        CatalogValidationResources(
            localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
            assetDigestsByPath: try PrototypeRoutineCatalog.assetDigests()
        )
    }

    private func signed(
        _ catalog: RoutineCatalog,
        primaryTemplates: [PrimaryTemplateVariant]? = nil,
        secondaryModules: [SecondaryModuleVariant]? = nil,
        compatibilityRules: [CompatibilityRule]? = nil
    ) throws -> RoutineCatalog {
        try RoutineCatalog.makeSigned(
            schemaVersion: catalog.schemaVersion,
            catalogVersion: catalog.catalogVersion,
            createdAt: catalog.createdAt,
            buildEligibility: catalog.buildEligibility,
            durationPolicies: catalog.durationPolicies,
            movements: catalog.movements,
            fragments: catalog.fragments,
            primaryTemplates: primaryTemplates ?? catalog.primaryTemplates,
            secondaryModules: secondaryModules ?? catalog.secondaryModules,
            compatibilityRules: compatibilityRules ?? catalog.compatibilityRules
        )
    }

    private func compatibilityRule(
        from original: CompatibilityRule,
        allowed: Bool
    ) throws -> CompatibilityRule {
        try CompatibilityRule(
            metadata: original.metadata,
            primaryArea: original.primaryArea,
            secondaryArea: original.secondaryArea,
            level: original.level,
            duration: original.duration,
            primaryTemplateID: original.primaryTemplateID,
            slotID: original.slotID,
            secondaryModuleID: original.secondaryModuleID,
            allowed: allowed,
            transitionOrderReviewed: original.transitionOrderReviewed,
            duplicateMovementReviewed: original.duplicateMovementReviewed,
            equipmentReviewed: original.equipmentReviewed,
            positionChangesReviewed: original.positionChangesReviewed,
            cueInteractionReviewed: original.cueInteractionReviewed
        )
    }

    private func duplicateMetadata(_ original: ContentMetadata) throws -> ContentMetadata {
        try ContentMetadata(
            id: CatalogID(validating: "kineo.primary.duplicate.gentle.quick.v1"),
            revision: original.revision,
            reviewStatus: original.reviewStatus,
            locale: original.locale,
            displayNameKey: original.displayNameKey,
            accessibilityDescriptionKey: original.accessibilityDescriptionKey,
            contentOwner: original.contentOwner,
            reviewedBy: original.reviewedBy,
            reviewedAt: original.reviewedAt,
            reviewEvidenceID: original.reviewEvidenceID,
            intendedBuilds: original.intendedBuilds
        )
    }

    private func expectedNominal(for duration: DurationVariant) -> Int {
        switch duration {
        case .quick: PrototypeCatalogDurations.quickNominalSeconds
        case .standard: PrototypeCatalogDurations.standardNominalSeconds
        }
    }
}

private enum ComposerFixture {
    static let decisionID = "00000000-0000-0000-0000-000000000001"
    static let compositionIDFormat = "00000000-0000-0000-0000-%012d"
    static let firstCompositionNumber = 1
    static let secondCompositionNumber = 2
    static let secondaryItemCount = 1
    static let budgetOverflowSeconds = 1
    static let unapprovedEquipment = "prototype-band"
    static let durations: [DurationVariant] = [.quick, .standard]
}

private enum ComposerFixtureError: Error {
    case expectedRoutine
}
