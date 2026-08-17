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

        let standardAgain = try await service.revisePlan(
            checkInID: standard.checkInID,
            duration: .standard,
            requestedLevel: nil
        )
        let standardRetry = try await service.revisePlan(
            checkInID: standard.checkInID,
            duration: .standard,
            requestedLevel: nil
        )
        #expect(standardAgain.decisionID != standard.decisionID)
        #expect(standardRetry.decisionID == standardAgain.decisionID)

        var routine = try await service.startRoutine(decisionID: standardAgain.decisionID)
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
        guard case .attentionRequired(let prompt) = result else {
            Issue.record("Expected Attention after a triggering answer.")
            return
        }
        #expect(prompt.area == .lowerBack)
        await #expect(throws: ProductFlowError.attentionRequired([.lowerBack])) {
            _ = try await service.beginSingleAreaCheckIn()
        }

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.map(\.area) == [.lowerBack])
        #expect(persisted.decisions.isEmpty)
        #expect(persisted.routineSessions.isEmpty)
    }

    @Test("Attention answers and correction preserve the gate until a valid clear commits")
    func attentionReturnAndCorrection() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .upperMidBack)

        let draft = try await service.beginSingleAreaCheckIn()
        guard case .attentionRequired = try await service.submitSingleAreaCheckIn(
            draft,
            change: .worse,
            comfort: .okay,
            safetyAnswer: .notSure
        ) else {
            Issue.record("Expected the original check-in to enter Attention.")
            return
        }
        guard case .attentionRequired(let initialPrompt) = try await service.loadProductStartState()
        else {
            Issue.record("Expected relaunch to restore the Attention prompt.")
            return
        }

        guard case .attentionRequired(let reaffirmedPrompt) = try await service.respondToAttentionReturn(
            initialPrompt,
            answer: .no
        ) else {
            Issue.record("No must keep Attention active.")
            return
        }
        #expect(reaffirmedPrompt.expectedAttentionUpdatedAt > initialPrompt.expectedAttentionUpdatedAt)

        let correction = try await service.beginAttentionCorrection(reaffirmedPrompt)
        let cleared = try await service.submitAttentionCorrection(
            correction,
            change: .similar,
            comfort: .okay,
            safetyAnswer: nil
        )
        #expect(cleared == .ready(.upperMidBack))
        #expect(
            try await service.submitAttentionCorrection(
                correction,
                change: .similar,
                comfort: .okay,
                safetyAnswer: nil
            ) == .ready(.upperMidBack)
        )
        #expect(try await service.loadProductStartState() == .today(.upperMidBack))

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.isEmpty)
        #expect(persisted.checkIns.count == ProductServiceFixture.attentionCorrectionCheckInCount)
        #expect(persisted.safetyEvents.map(\.kind) == [
            .attentionEntered,
            .attentionReaffirmed,
            .attentionClearedCorrection
        ])
        #expect(persisted.decisions.isEmpty)
    }

    @Test("Returned to usual clears only through Yes and safely replays")
    func returnedToUsualClear() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .lowerBack)
        let draft = try await service.beginSingleAreaCheckIn()
        guard case .attentionRequired(let prompt) = try await service.submitSingleAreaCheckIn(
            draft,
            change: .similar,
            comfort: .limited,
            safetyAnswer: .yes
        ) else {
            Issue.record("Expected Attention before the return answer.")
            return
        }

        #expect(try await service.respondToAttentionReturn(prompt, answer: .yes) == .ready(.lowerBack))
        #expect(try await service.respondToAttentionReturn(prompt, answer: .yes) == .ready(.lowerBack))
        _ = try await service.beginSingleAreaCheckIn()

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.isEmpty)
        #expect(persisted.safetyEvents.map(\.kind) == [
            .attentionEntered,
            .attentionClearedReturnedToUsual
        ])
        #expect(persisted.decisions.isEmpty)
    }

    @Test("A triggering correction reaffirms Attention and creates no plan")
    func triggeringCorrectionReaffirmsAttention() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .neck)
        let draft = try await service.beginSingleAreaCheckIn()
        guard case .attentionRequired(let prompt) = try await service.submitSingleAreaCheckIn(
            draft,
            change: .worse,
            comfort: .good,
            safetyAnswer: .notSure
        ) else {
            Issue.record("Expected Attention before correction.")
            return
        }

        let correction = try await service.beginAttentionCorrection(prompt)
        guard case .attentionRequired(let nextPrompt) = try await service.submitAttentionCorrection(
            correction,
            change: .worse,
            comfort: .good,
            safetyAnswer: .yes
        ) else {
            Issue.record("A triggering correction must preserve Attention.")
            return
        }
        #expect(nextPrompt.area == .neck)

        let persisted = try await fixture.snapshot()
        #expect(persisted.attentionStates.map(\.area) == [.neck])
        #expect(persisted.safetyEvents.map(\.kind) == [
            .attentionEntered,
            .attentionReaffirmedCorrection
        ])
        #expect(persisted.decisions.isEmpty)
    }

    @Test("Pause Today is eligible once, creates no routine, and survives retry")
    func pauseToday() async throws {
        let fixture = try ProductServiceFixture()
        defer { fixture.removeFiles() }
        let service = fixture.service
        try await fixture.completeOnboarding(area: .neck)

        let draft = try await service.beginSingleAreaCheckIn()
        guard case .plan(let plan) = try await service.submitSingleAreaCheckIn(
            draft,
            change: .similar,
            comfort: .limited,
            safetyAnswer: .no
        ) else {
            Issue.record("Expected a Gentle plan with Pause Today.")
            return
        }
        #expect(plan.recommendedLevel == .gentle)
        #expect(plan.pauseTodayAvailable)
        #expect(try await service.pauseToday(checkInID: plan.checkInID) == .neck)
        #expect(try await service.pauseToday(checkInID: plan.checkInID) == .neck)
        await #expect(throws: ProductFlowError.persistence(.conflictingWrite)) {
            _ = try await service.startRoutine(decisionID: plan.decisionID)
        }

        let persisted = try await fixture.snapshot()
        #expect(persisted.pauseTodayEvents.count == ProductServiceFixture.pauseTodayEventCount)
        #expect(persisted.routineSessions.isEmpty)
    }
}

private struct ProductServiceFixture {
    static let completedCheckInCount = 1
    static let planRevisionCount = 3
    static let attentionCorrectionCheckInCount = 2
    static let pauseTodayEventCount = 1

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

    func completeOnboarding(area: BodyArea) async throws {
        #expect(await service.initialState() == .foundationReady)
        try await service.confirmAdultEligibility()
        try await service.savePrimaryArea(area)
        try await service.acknowledgeSafetyBoundary()
        _ = try await service.completeOnboarding()
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
