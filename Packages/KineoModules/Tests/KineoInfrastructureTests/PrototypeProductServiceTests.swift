import Foundation
import KineoCore
@testable import KineoInfrastructure
import Testing

@Suite("Prototype product service")
struct PrototypeProductServiceTests {
    @Test("Single-area onboarding through feedback persists the complete product loop")
    func completeSingleAreaLoop() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service

        #expect(await service.initialState() == .foundationReady)
        #expect(try await service.loadProductStartState() == .onboarding(.welcome))
        try await service.confirmAdultEligibility()
        #expect(try await service.loadProductStartState() == .onboarding(.primaryArea))
        try await service.savePrimaryArea(.neck)
        #expect(
            try await service.loadProductStartState() == .onboarding(.safetyBoundary(.neck))
        )
        try await service.acknowledgeSafetyBoundary()
        #expect(
            try await service.loadProductStartState() == .onboarding(.firstCheckIn(.neck))
        )
        #expect(try await service.completeOnboarding() == .neck)

        let draft = try await service.beginSingleAreaCheckIn()
        let result = try await service.submitSingleAreaCheckIn(
            draft,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        )
        guard case .plan(let standard) = result else {
            Issue.record("Expected a plan after a non-triggering check-in.")
            return
        }
        #expect(standard.area == .neck)
        #expect(standard.selectedLevel == .balanced)
        #expect(standard.duration == .standard)

        let quick = try await service.revisePlan(
            checkInID: standard.checkInID,
            duration: .quick,
            requestedLevel: nil
        )
        #expect(quick.selectedLevel == standard.selectedLevel)
        #expect(quick.duration == .quick)

        var routine = try await service.startRoutine(decisionID: quick.decisionID)
        #expect(routine.status == .inProgress)
        while !routine.status.isTerminal {
            routine = try await service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
        }
        #expect(routine.status == .completed)
        #expect(routine.currentStepIndex == routine.totalStepCount)
        try await service.submitFeedback(sessionID: routine.sessionID, response: .same)

        let persisted = try await fixture.snapshot()
        #expect(persisted.profileState?.profile.onboardingCompletedAt != nil)
        #expect(persisted.checkIns.count == ProductServiceFixture.completedCheckInCount)
        #expect(persisted.decisions.count == ProductServiceFixture.planRevisionCount)
        #expect(persisted.routineSessions.first?.status == .completed)
        #expect(persisted.feedbackSubmissions.first?.responses.first?.response == .same)
    }

    @Test("A triggering answer enters global Attention and no plan is created")
    func attentionBlocksPlans() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        #expect(await service.initialState() == .foundationReady)
        try await service.confirmAdultEligibility()
        try await service.savePrimaryArea(.lowerBack)
        try await service.acknowledgeSafetyBoundary()
        _ = try await service.completeOnboarding()

        let draft = try await service.beginSingleAreaCheckIn()
        let result = try await service.submitSingleAreaCheckIn(
            draft,
            change: .worse,
            comfort: .limited,
            safetyAnswer: .notSure
        )
        #expect(result == .attentionRequired(.lowerBack))
        await #expect(throws: ProductFlowError.attentionRequired([.lowerBack])) {
            _ = try await service.beginSingleAreaCheckIn()
        }

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.map(\.area) == [.lowerBack])
        #expect(persisted.decisions.isEmpty)
        #expect(persisted.routineSessions.isEmpty)
    }
}

private struct ProductServiceFixture {
    static let completedCheckInCount = 1
    static let planRevisionCount = 2

    let root: URL
    let location: KineoStoreLocation
    let service: PrototypeProductService

    init() throws {
        root = FileManager.default.temporaryDirectory.appending(
            path: "KineoProductServiceTests-\(UUID().uuidString)",
            directoryHint: .isDirectory
        )
        location = KineoStoreLocation(applicationSupportURL: root)
        service = PrototypeProductService(
            location: location,
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: NoOpKineoStorageProtector(),
            clock: FixedProductClock()
        )
    }

    func snapshot() async throws -> KineoDataSnapshot {
        let store = try await KineoGRDBStore.open(
            location: location,
            protectedData: AlwaysAvailableProtectedData(),
            storageProtector: NoOpKineoStorageProtector()
        )
        return try await store.loadSnapshot()
    }

    func removeFiles() {
        do {
            try FileManager.default.removeItem(at: root)
        } catch CocoaError.fileNoSuchFile {
            // A missing temporary directory is already the desired cleanup state.
        } catch {
            Issue.record("Failed to remove product-service test files: \(error)")
        }
    }
}

private struct FixedProductClock: ProductClock {
    func now() -> ProductMoment? {
        guard let day = LocalDay(rawValue: "2026-08-17"),
              let timeZone = NonEmptyString(rawValue: "America/Chicago"),
              let calendar = NonEmptyString(rawValue: "gregorian") else {
            return nil
        }
        return ProductMoment(
            timestamp: TimestampMilliseconds(rawValue: 1_787_000_000_000),
            dayContext: LocalDayContext(
                localDay: day,
                timeZoneID: timeZone,
                calendarID: calendar
            )
        )
    }
}
