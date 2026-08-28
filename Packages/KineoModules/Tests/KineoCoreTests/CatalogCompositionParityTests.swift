import Foundation
import KineoCore
import Testing

@Suite("Expo catalog and composition parity")
struct CatalogCompositionParityTests {
    @Test("Swift matches the shared Expo content fingerprint fixture")
    private func sharedContentFingerprintParity() throws {
        let fixtureURL = try #require(
            Bundle.module.url(
                forResource: "catalog-composition-parity-v1",
                withExtension: "json"
            )
        )
        let fixture = try JSONDecoder().decode(
            ContentParityFixture.self,
            from: Data(contentsOf: fixtureURL)
        )
        let catalog = try PrototypeRoutineCatalog.make()

        #expect(catalog.manifestFingerprint.rawValue == fixture.catalogManifestFingerprint)

        let request = try CatalogCompositionRequest(
            decisionID: SelectionDecisionID(validating: FixtureIdentity.decisionID),
            primaryArea: fixture.singleArea.primaryArea,
            secondaryArea: nil,
            selectedLevel: fixture.singleArea.level,
            duration: fixture.singleArea.duration,
            catalogVersion: catalog.catalogVersion,
            buildChannel: .internalPrototype
        )
        let result = RoutineComposer.compose(
            request: request,
            catalog: catalog,
            resources: CatalogValidationResources(
                localizedStrings: try PrototypeRoutineCatalog.localizedStrings(),
                assetDigestsByPath: try PrototypeRoutineCatalog.assetDigests()
            ),
            compositionID: try CompositionID(validating: FixtureIdentity.compositionID)
        )
        guard case .composed(let routine) = result else {
            Issue.record("Expected the shared parity request to compose.")
            return
        }

        #expect(routine.status.rawValue == fixture.singleArea.status)
        #expect(routine.nominalSeconds == fixture.singleArea.nominalSeconds)
        #expect(routine.fingerprint.rawValue == fixture.singleArea.fingerprint)
    }
}

private struct ContentParityFixture: Decodable {
    let catalogManifestFingerprint: String
    let singleArea: SingleArea

    struct SingleArea: Decodable {
        let primaryArea: BodyArea
        let level: RoutineLevel
        let duration: DurationVariant
        let status: String
        let nominalSeconds: Int
        let fingerprint: String
    }
}

private enum FixtureIdentity {
    static let decisionID = "00000000-0000-0000-0000-000000000001"
    static let compositionID = "00000000-0000-0000-0000-000000000002"
}
