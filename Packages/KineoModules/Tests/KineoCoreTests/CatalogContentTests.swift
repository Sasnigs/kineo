import Foundation
import KineoCore
import Testing

@Suite("Catalog content graph")
struct CatalogContentTests {
    private let movementSeconds = 60
    private let slotSeconds = 120

    @Test("Sequence items accept only the fields required by their kind")
    func sequenceItemShapes() throws {
        let movement = try movementItem()
        let transition = try transitionItem()
        let replacement = try replacementItem()

        #expect(movement.kind == .movement)
        #expect(transition.kind == .transition)
        #expect(replacement.kind == .replacementSlot)
        #expect(throws: CatalogValidationError.invalidSequenceItem("movement")) {
            try SequenceItem(
                itemID: identifier("owner.item.invalid-movement"),
                kind: .movement,
                movementID: nil,
                dose: nil,
                fixedSeconds: movementSeconds,
                slot: nil
            )
        }
        #expect(throws: CatalogValidationError.invalidSequenceItem("transition")) {
            try SequenceItem(
                itemID: identifier("owner.item.invalid-transition"),
                kind: .transition,
                movementID: nil,
                dose: nil,
                fixedSeconds: 0,
                slot: nil
            )
        }
    }

    @Test("Sequence decoding rejects an invalid field combination")
    func sequenceDecodingRevalidatesShape() {
        let invalid = Data(
            #"{"itemID":"owner.item.invalid","kind":"rest","fixedSeconds":0}"#.utf8
        )
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(SequenceItem.self, from: invalid)
        }
    }

    @Test("Fragments and modules reject slots while primaries require exactly one")
    func artifactSlotBoundaries() throws {
        let movement = try movementItem()
        let replacement = try replacementItem()

        #expect(
            try RoutineFragment(
                metadata: metadata(id: "kineo.fragment.test.quick.v1"),
                area: .neck,
                level: .gentle,
                duration: .quick,
                items: [movement]
            ).items == [movement]
        )
        #expect(throws: CatalogValidationError.invalidArtifact("slotCount")) {
            try RoutineFragment(
                metadata: metadata(id: "kineo.fragment.invalid.quick.v1"),
                area: .neck,
                level: .gentle,
                duration: .quick,
                items: [replacement]
            )
        }
        #expect(throws: CatalogValidationError.invalidArtifact("slotCount")) {
            try PrimaryTemplateVariant(
                metadata: metadata(id: "kineo.primary.invalid.quick.v1"),
                area: .neck,
                level: .gentle,
                duration: .quick,
                nominalSeconds: PrototypeCatalogDurations.quickNominalSeconds,
                items: [movement]
            )
        }
        #expect(throws: CatalogValidationError.invalidArtifact("slotCount")) {
            try SecondaryModuleVariant(
                metadata: metadata(id: "kineo.secondary.invalid.quick.v1"),
                area: .lowerBack,
                level: .gentle,
                duration: .quick,
                slotKind: .secondaryFocus,
                nominalSeconds: slotSeconds,
                position: .prototypeAbstract,
                equipment: [],
                items: [replacement]
            )
        }
    }

    @Test("Sequence artifacts reject duplicate item identifiers")
    func duplicateItemIdentifiers() throws {
        let movement = try movementItem()
        #expect(throws: CatalogValidationError.invalidArtifact("duplicateItemID")) {
            try RoutineFragment(
                metadata: metadata(id: "kineo.fragment.duplicate.quick.v1"),
                area: .neck,
                level: .gentle,
                duration: .quick,
                items: [movement, movement]
            )
        }
    }

    @Test("Associated alternative dose policies use a stable tagged representation")
    func alternativeDosePolicyCodable() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let preserved = AlternativeDosePolicy.preserveScheduledDose
        let explicit = AlternativeDosePolicy.explicit(try dose())

        #expect(
            try decoder.decode(
                AlternativeDosePolicy.self,
                from: encoder.encode(preserved)
            ) == preserved
        )
        #expect(
            try decoder.decode(AlternativeDosePolicy.self, from: encoder.encode(explicit)) == explicit
        )

        let invalidPreservedDose = Data(
            #"{"kind":"preserve_scheduled_dose","dose":{"kind":"timed","activeSeconds":60,"estimatedSeconds":60}}"#.utf8
        )
        #expect(throws: DecodingError.self) {
            try decoder.decode(AlternativeDosePolicy.self, from: invalidPreservedDose)
        }
    }

    @Test("Movement construction and decoding reject empty support sets")
    func movementSupportIsRequired() throws {
        let valid = try movementDefinition()
        #expect(throws: CatalogValidationError.invalidArtifact("supportedAreas")) {
            try MovementDefinition(
                metadata: valid.metadata,
                supportedAreas: [],
                supportedLevels: valid.supportedLevels,
                position: valid.position,
                equipment: valid.equipment,
                instructionKey: valid.instructionKey,
                safetyCueKey: valid.safetyCueKey,
                media: valid.media,
                spokenCueKey: valid.spokenCueKey,
                alternatives: valid.alternatives
            )
        }

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        let encoded = try encoder.encode(valid)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object["supportedAreas"] = []
        let invalid = try JSONSerialization.data(withJSONObject: object)
        #expect(throws: DecodingError.self) {
            try decoder.decode(MovementDefinition.self, from: invalid)
        }
    }

    @Test("Compatibility rules cannot target the same primary and secondary area")
    func compatibilityRequiresDistinctAreas() throws {
        #expect(throws: CatalogValidationError.invalidArtifact("compatibilityAreas")) {
            try CompatibilityRule(
                metadata: metadata(id: "kineo.compat.invalid.quick.v1"),
                primaryArea: .neck,
                secondaryArea: .neck,
                level: .gentle,
                duration: .quick,
                primaryTemplateID: identifier("kineo.primary.neck.gentle.quick.v1"),
                slotID: identifier("kineo.primary.neck.gentle.quick.v1.slot.secondary-focus"),
                secondaryModuleID: identifier("kineo.secondary.neck.gentle.quick.v1"),
                allowed: true,
                transitionOrderReviewed: true,
                duplicateMovementReviewed: true,
                equipmentReviewed: true,
                positionChangesReviewed: true,
                cueInteractionReviewed: true
            )
        }
    }

    private func movementDefinition() throws -> MovementDefinition {
        try MovementDefinition(
            metadata: metadata(id: "kineo.prototype.movement.neck.base.1.v1"),
            supportedAreas: [.neck],
            supportedLevels: Set(RoutineLevel.allCases),
            position: .prototypeAbstract,
            equipment: [],
            instructionKey: text("prototype.instruction"),
            safetyCueKey: text("prototype.safety"),
            media: nil,
            spokenCueKey: nil,
            alternatives: []
        )
    }

    private func movementItem() throws -> SequenceItem {
        try SequenceItem(
            itemID: identifier("owner.item.movement"),
            kind: .movement,
            movementID: identifier("kineo.prototype.movement.neck.base.1.v1"),
            dose: dose(),
            fixedSeconds: nil,
            slot: nil
        )
    }

    private func transitionItem() throws -> SequenceItem {
        try SequenceItem(
            itemID: identifier("owner.item.transition"),
            kind: .transition,
            movementID: nil,
            dose: nil,
            fixedSeconds: movementSeconds,
            slot: nil
        )
    }

    private func replacementItem() throws -> SequenceItem {
        try SequenceItem(
            itemID: identifier("owner.item.slot"),
            kind: .replacementSlot,
            movementID: nil,
            dose: nil,
            fixedSeconds: nil,
            slot: ReplacementSlot(
                slotID: identifier("owner.slot.secondary-focus"),
                kind: .secondaryFocus,
                budget: DurationBudget(
                    minimumSeconds: slotSeconds,
                    nominalSeconds: slotSeconds,
                    maximumSeconds: slotSeconds
                ),
                defaultFragmentID: identifier("kineo.fragment.neck.gentle.quick.default.v1"),
                allowedPositions: [.prototypeAbstract],
                allowedEquipment: []
            )
        )
    }

    private func dose() throws -> Dose {
        try Dose(
            kind: .timed,
            activeSeconds: movementSeconds,
            repetitionCount: nil,
            estimatedSeconds: movementSeconds
        )
    }

    private func metadata(id: String) throws -> ContentMetadata {
        try ContentMetadata(
            id: identifier(id),
            revision: ContentRevision(validating: 1),
            reviewStatus: .prototypePlaceholder,
            locale: "en-US",
            displayNameKey: text("prototype.display-name"),
            accessibilityDescriptionKey: text("prototype.accessibility-description"),
            contentOwner: text("Kineo prototype"),
            reviewedBy: nil,
            reviewedAt: nil,
            reviewEvidenceID: nil,
            intendedBuilds: [.internalPrototype]
        )
    }

    private func identifier(_ value: String) throws -> CatalogID {
        try CatalogID(validating: value)
    }

    private func text(_ value: String) throws -> NonEmptyString {
        try NonEmptyString(validating: value)
    }
}
