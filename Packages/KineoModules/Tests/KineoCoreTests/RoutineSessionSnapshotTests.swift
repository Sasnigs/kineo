import Foundation
import KineoCore
import Testing

@Suite("Routine session snapshot")
struct RoutineSessionSnapshotTests {
    @Test("Snapshot freezes localized items, alternatives, sources, and composition fingerprint")
    func snapshotFreezesPresentation() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let composition = try composedRoutine(catalog: catalog, secondaryArea: .lowerBack)
        let snapshot = try makeSnapshot(composition: composition, catalog: catalog)

        #expect(snapshot.fingerprint == composition.fingerprint)
        #expect(snapshot.catalogVersion == composition.catalogVersion)
        #expect(snapshot.compositionID == composition.compositionID)
        #expect(snapshot.includedAreas == [.neck, .lowerBack])
        #expect(snapshot.items.count == composition.orderedItems.count)
        #expect(snapshot.items.contains { $0.sourceRole == .secondaryModule })

        let movementItems = snapshot.items.filter { $0.movementID != nil }
        #expect(!movementItems.isEmpty)
        for item in movementItems {
            #expect(item.localizedTitle.rawValue.contains(SnapshotFixture.prototypeLabel))
            #expect(item.localizedInstruction != nil)
            #expect(item.localizedSafetyCue != nil)
            #expect(item.accessibleDescription != nil)
            #expect(item.scheduledDose != nil)
            #expect(item.availableAlternatives.count == SnapshotFixture.alternativeCount)
            #expect(item.availableAlternatives.first?.scheduledDose == item.scheduledDose)
        }
    }

    @Test("Snapshot round-trips and its opaque checksum covers the exact encoded bytes")
    func snapshotPersistenceRepresentation() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let snapshot = try makeSnapshot(
            composition: composedRoutine(catalog: catalog, secondaryArea: nil),
            catalog: catalog
        )
        let encoded = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(RoutineSessionSnapshot.self, from: encoded)
        let opaque = try snapshot.opaqueRepresentation()
        let opaqueDecoded = try JSONDecoder().decode(
            RoutineSessionSnapshot.self,
            from: opaque.bytes
        )

        #expect(decoded == snapshot)
        #expect(opaqueDecoded == snapshot)
        #expect(opaque.includedAreas == snapshot.includedAreas)
        #expect(opaque.bytes.isEmpty == false)
    }

    @Test("Snapshot construction fails when required presentation content is missing")
    func missingPresentationFails() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let composition = try composedRoutine(catalog: catalog, secondaryArea: nil)
        var strings = try PrototypeRoutineCatalog.localizedStrings()
        let movementID = try #require(composition.orderedItems.compactMap(\.item.movementID).first)
        let movement = try #require(catalog.movements.first { $0.metadata.id == movementID })
        let missingKey = movement.metadata.displayNameKey.rawValue
        strings.removeValue(forKey: missingKey)
        let incomplete = CatalogValidationResources(
            localizedStrings: strings,
            assetDigestsByPath: try PrototypeRoutineCatalog.assetDigests()
        )

        #expect(throws: CatalogValidationError.missingLocalization(missingKey)) {
            try RoutineSessionSnapshotBuilder.make(
                sessionID: sessionID(),
                decisionID: decisionID(),
                composition: composition,
                catalog: catalog,
                resources: incomplete,
                rulesVersion: text(SnapshotFixture.rulesVersion),
                notices: [text(SnapshotFixture.notice)],
                explanationKeys: [text(SnapshotFixture.explanationKey)],
                explanationParameters: [[SnapshotFixture.parameterKey: SnapshotFixture.parameterValue]],
                createdAt: TimestampMilliseconds(rawValue: SnapshotFixture.createdAtMilliseconds)
            )
        }
    }

    @Test("Snapshot decoding rejects misaligned explanation presentation")
    func snapshotDecodingRevalidates() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let snapshot = try makeSnapshot(
            composition: composedRoutine(catalog: catalog, secondaryArea: nil),
            catalog: catalog
        )
        let encoded = try JSONEncoder().encode(snapshot)
        var object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object["presentedExplanationParameters"] = []
        let invalid = try JSONSerialization.data(withJSONObject: object)

        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(RoutineSessionSnapshot.self, from: invalid)
        }
    }

    @Test("Only alternatives frozen for the selected item can be resolved")
    func alternativeLookupIsBounded() throws {
        let catalog = try PrototypeRoutineCatalog.make()
        let snapshot = try makeSnapshot(
            composition: composedRoutine(catalog: catalog, secondaryArea: nil),
            catalog: catalog
        )
        let item = try #require(snapshot.items.first { !$0.availableAlternatives.isEmpty })
        let offered = try #require(item.availableAlternatives.first)
        #expect(
            try snapshot.alternative(offered.movementID, forItem: item.itemID) == offered
        )

        let unknown = try CatalogID(validating: "kineo.prototype.movement.unknown.v1")
        #expect(throws: RoutineAlternativeSelectionError.alternativeNotOffered(unknown)) {
            try snapshot.alternative(unknown, forItem: item.itemID)
        }
    }

    private func composedRoutine(
        catalog: RoutineCatalog,
        secondaryArea: BodyArea?
    ) throws -> ComposedRoutine {
        let request = try CatalogCompositionRequest(
            decisionID: decisionID(),
            primaryArea: .neck,
            secondaryArea: secondaryArea,
            selectedLevel: .balanced,
            duration: .standard,
            catalogVersion: catalog.catalogVersion,
            buildChannel: .internalPrototype
        )
        let result = RoutineComposer.compose(
            request: request,
            catalog: catalog,
            resources: try resources(),
            compositionID: try compositionID()
        )
        guard case .composed(let routine) = result else {
            Issue.record("Expected a composed routine, received \(result).")
            throw SnapshotFixtureError.expectedComposition
        }
        return routine
    }

    private func makeSnapshot(
        composition: ComposedRoutine,
        catalog: RoutineCatalog
    ) throws -> RoutineSessionSnapshot {
        try RoutineSessionSnapshotBuilder.make(
            sessionID: sessionID(),
            decisionID: decisionID(),
            composition: composition,
            catalog: catalog,
            resources: resources(),
            rulesVersion: text(SnapshotFixture.rulesVersion),
            notices: [text(SnapshotFixture.notice)],
            explanationKeys: [text(SnapshotFixture.explanationKey)],
            explanationParameters: [[SnapshotFixture.parameterKey: SnapshotFixture.parameterValue]],
            createdAt: TimestampMilliseconds(rawValue: SnapshotFixture.createdAtMilliseconds)
        )
    }

    private func resources() throws -> CatalogValidationResources {
        CatalogValidationResources(
            localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
            assetDigestsByPath: try PrototypeRoutineCatalog.assetDigests()
        )
    }

    private func sessionID() throws -> RoutineSessionID {
        try RoutineSessionID(validating: SnapshotFixture.sessionID)
    }

    private func decisionID() throws -> SelectionDecisionID {
        try SelectionDecisionID(validating: SnapshotFixture.decisionID)
    }

    private func compositionID() throws -> CompositionID {
        try CompositionID(validating: SnapshotFixture.compositionID)
    }

    private func text(_ value: String) throws -> NonEmptyString {
        try NonEmptyString(validating: value)
    }
}

private enum SnapshotFixture {
    static let sessionID = "00000000-0000-0000-0000-000000000001"
    static let decisionID = "00000000-0000-0000-0000-000000000002"
    static let compositionID = "00000000-0000-0000-0000-000000000003"
    static let rulesVersion = "prototype-rules-1"
    static let notice = "Prototype content"
    static let explanationKey = "prototype.explanation"
    static let parameterKey = "area"
    static let parameterValue = "neck"
    static let prototypeLabel = "Prototype"
    static let alternativeCount = 1
    static let createdAtMilliseconds: Int64 = 1_750_000_000_000
}

private enum SnapshotFixtureError: Error {
    case expectedComposition
}
