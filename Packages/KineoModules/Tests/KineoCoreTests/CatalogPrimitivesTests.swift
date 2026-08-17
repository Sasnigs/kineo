import Foundation
import KineoCore
import Testing

@Suite("Catalog primitives")
struct CatalogPrimitivesTests {
    @Test("Catalog IDs accept only lowercase namespaced slugs")
    private func catalogIDShape() throws {
        let valid = [
            "kineo.primary.neck.gentle.quick.v1",
            "kineo.primary.upper-mid-back.active.standard.v1",
            "owner.item.1"
        ]
        let invalid = [
            "",
            "single",
            "Kineo.primary.neck",
            "kineo..neck",
            ".kineo.neck",
            "kineo.neck-",
            "kineo.neck_focus"
        ]

        for rawValue in valid {
            #expect(CatalogID(rawValue: rawValue) != nil)
        }
        for rawValue in invalid {
            #expect(CatalogID(rawValue: rawValue) == nil)
            #expect(throws: CatalogValidationError.invalidIdentifier(rawValue)) {
                try CatalogID(validating: rawValue)
            }
        }
    }

    @Test("Catalog scalar values round-trip and revalidate decoding")
    private func scalarCodable() throws {
        let identifier = try CatalogID(validating: "kineo.test.record.v1")
        let revision = try ContentRevision(validating: 1)
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        #expect(try decoder.decode(CatalogID.self, from: encoder.encode(identifier)) == identifier)
        #expect(try decoder.decode(ContentRevision.self, from: encoder.encode(revision)) == revision)
        #expect(throws: DecodingError.self) {
            try decoder.decode(CatalogID.self, from: Data(#""UPPER.invalid""#.utf8))
        }
        #expect(throws: DecodingError.self) {
            try decoder.decode(ContentRevision.self, from: Data("0".utf8))
        }
    }

    @Test("Duration policies require positive ordered bounds")
    private func durationPolicyBounds() throws {
        let quick = try DurationPolicy(
            variant: .quick,
            nominalSeconds: PrototypeCatalogDurations.quickNominalSeconds,
            minimumSeconds: PrototypeCatalogDurations.quickMinimumSeconds,
            maximumSeconds: PrototypeCatalogDurations.quickMaximumSeconds
        )
        #expect(quick.minimumSeconds <= quick.nominalSeconds)
        #expect(quick.nominalSeconds <= quick.maximumSeconds)

        #expect(throws: CatalogValidationError.invalidDuration(DurationVariant.quick.rawValue)) {
            try DurationPolicy(
                variant: .quick,
                nominalSeconds: PrototypeCatalogDurations.quickNominalSeconds,
                minimumSeconds: PrototypeCatalogDurations.quickMaximumSeconds,
                maximumSeconds: PrototypeCatalogDurations.quickMinimumSeconds
            )
        }
    }

    @Test("Dose fields must match their kind")
    private func doseShapes() throws {
        let timedSeconds = 60
        let repetitionCount = 8
        let repetitionEstimate = 45
        #expect(
            try Dose(
                kind: .timed,
                activeSeconds: timedSeconds,
                repetitionCount: nil,
                estimatedSeconds: timedSeconds
            ).activeSeconds == timedSeconds
        )
        #expect(
            try Dose(
                kind: .repetitions,
                activeSeconds: nil,
                repetitionCount: repetitionCount,
                estimatedSeconds: repetitionEstimate
            ).repetitionCount == repetitionCount
        )
        #expect(throws: CatalogValidationError.invalidDose) {
            try Dose(
                kind: .timed,
                activeSeconds: nil,
                repetitionCount: repetitionCount,
                estimatedSeconds: timedSeconds
            )
        }
        #expect(throws: CatalogValidationError.invalidDose) {
            try Dose(
                kind: .repetitions,
                activeSeconds: nil,
                repetitionCount: 0,
                estimatedSeconds: repetitionEstimate
            )
        }
    }

    @Test("Build eligibility follows review status and evidence")
    private func buildEligibility() throws {
        let prototype = try metadata(
            reviewStatus: .prototypePlaceholder,
            intendedBuilds: [.internalPrototype]
        )
        let draft = try metadata(reviewStatus: .draft, intendedBuilds: [.internalPrototype])
        let approved = try metadata(
            reviewStatus: .approvedForRelease,
            reviewedBy: string("reviewer"),
            reviewedAt: TimestampMilliseconds(rawValue: 1),
            reviewEvidenceID: string("evidence"),
            intendedBuilds: [.internalPrototype, .publicRelease]
        )

        #expect(prototype.isEligible(for: .internalPrototype))
        #expect(!prototype.isEligible(for: .publicRelease))
        #expect(!draft.isEligible(for: .internalPrototype))
        #expect(approved.isEligible(for: .internalPrototype))
        #expect(approved.isEligible(for: .publicRelease))
    }

    @Test("Prototype metadata cannot claim review or public eligibility")
    private func prototypeMetadataIsBounded() throws {
        #expect(throws: CatalogValidationError.invalidMetadata("prototypeReview")) {
            try metadata(
                reviewStatus: .prototypePlaceholder,
                reviewedBy: string("reviewer"),
                intendedBuilds: [.internalPrototype]
            )
        }
        #expect(throws: CatalogValidationError.invalidMetadata("prototypeReview")) {
            try metadata(
                reviewStatus: .prototypePlaceholder,
                intendedBuilds: [.internalPrototype, .publicRelease]
            )
        }
    }

    private func metadata(
        reviewStatus: ReviewStatus,
        reviewedBy: NonEmptyString? = nil,
        reviewedAt: TimestampMilliseconds? = nil,
        reviewEvidenceID: NonEmptyString? = nil,
        intendedBuilds: Set<BuildChannel>
    ) throws -> ContentMetadata {
        try ContentMetadata(
            id: CatalogID(validating: "kineo.test.metadata.v1"),
            revision: ContentRevision(validating: 1),
            reviewStatus: reviewStatus,
            locale: "en-US",
            displayNameKey: string("display.name"),
            accessibilityDescriptionKey: nil,
            contentOwner: string("Kineo"),
            reviewedBy: reviewedBy,
            reviewedAt: reviewedAt,
            reviewEvidenceID: reviewEvidenceID,
            intendedBuilds: intendedBuilds
        )
    }

    private func string(_ value: String) throws -> NonEmptyString {
        try NonEmptyString(validating: value)
    }
}
