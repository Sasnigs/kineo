import Foundation
import KineoCore
@testable import KineoUI
import Testing

@Suite("Product flow model")
@MainActor
struct ProductFlowModelTests {
    @Test("The model drives the complete single-area screen sequence")
    func completeScreenFlow() async throws {
        let service = ProductFlowServiceStub()
        let model = ProductFlowModel(service: service)

        await model.performPendingAction()
        #expect(model.state == .welcome)
        model.send(.getStarted)
        #expect(model.state == .ageConfirmation)
        model.send(.confirmAdult)
        await model.performPendingAction()
        #expect(model.state == .primaryArea(nil))
        model.send(.selectPrimaryArea(.neck))
        model.send(.continuePrimaryArea)
        await model.performPendingAction()
        #expect(model.state == .safetyBoundary(.neck))
        model.send(.acknowledgeSafety)
        await model.performPendingAction()
        #expect(model.state == .firstCheckIn(.neck))
        model.send(.completeOnboarding)
        await model.performPendingAction()
        #expect(model.state == .today(.neck))
        model.send(.startCheckIn)
        await model.performPendingAction()

        guard case .checkInChange = model.state else {
            Issue.record("Expected the first check-in question.")
            return
        }
        model.send(.selectChange(.similar))
        model.send(.selectComfort(.okay))
        await model.performPendingAction()
        guard case .plan(let plan) = model.state else {
            Issue.record("Expected a committed plan.")
            return
        }
        #expect(plan.duration == .standard)

        model.send(.chooseDuration(.quick))
        await model.performPendingAction()
        guard case .plan(let quickPlan) = model.state else {
            Issue.record("Expected a revised plan.")
            return
        }
        #expect(quickPlan.duration == .quick)
        #expect(quickPlan.selectedLevel == plan.selectedLevel)

        model.send(.startRoutine)
        await model.performPendingAction()
        guard case .routine = model.state else {
            Issue.record("Expected an active routine.")
            return
        }
        model.send(.advanceRoutine)
        await model.performPendingAction()
        guard case .feedback = model.state else {
            Issue.record("Expected optional feedback.")
            return
        }
        model.send(.submitFeedback(.same))
        await model.performPendingAction()
        #expect(model.state == .completion(.neck))
        model.send(.finishCompletion)
        #expect(model.state == .today(.neck))
    }

    @Test("A recoverable write failure keeps the truthful screen and retries the same intent")
    func retryPreservesScreen() async {
        let service = ProductFlowServiceStub(failAdultConfirmationOnce: true)
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.getStarted)
        model.send(.confirmAdult)
        await model.performPendingAction()

        #expect(model.state == .ageConfirmation)
        #expect(model.errorMessage != nil)
        model.send(.retry)
        await model.performPendingAction()
        #expect(model.state == .primaryArea(nil))
        #expect(model.errorMessage == nil)
    }

    @Test("Loading retries after protected data becomes available")
    func protectedDataRetry() async {
        let service = ProductFlowServiceStub(
            launchStates: [.protectedDataUnavailable, .foundationReady]
        )
        let model = ProductFlowModel(service: service)

        await model.performPendingAction()
        #expect(model.state == .launching(.protectedDataUnavailable))

        model.send(.load)
        await model.performPendingAction()
        #expect(model.state == .welcome)
    }
}

private actor ProductFlowServiceStub: KineoProductServing {
    private var failAdultConfirmationOnce: Bool
    private var launchStates: [AppLaunchState]
    private let checkInID = CheckInID(UUID())
    private let entryID = CheckInEntryID(UUID())
    private let decisionID = SelectionDecisionID(UUID())
    private let sessionID = RoutineSessionID(UUID())

    init(
        failAdultConfirmationOnce: Bool = false,
        launchStates: [AppLaunchState] = [.foundationReady]
    ) {
        self.failAdultConfirmationOnce = failAdultConfirmationOnce
        self.launchStates = launchStates
    }

    func initialState() async -> AppLaunchState {
        guard !launchStates.isEmpty else { return .foundationReady }
        return launchStates.removeFirst()
    }

    func loadProductStartState() async throws(ProductFlowError) -> ProductStartState {
        .onboarding(.welcome)
    }

    func confirmAdultEligibility() async throws(ProductFlowError) {
        if failAdultConfirmationOnce {
            failAdultConfirmationOnce = false
            throw .persistence(.writeFailed)
        }
    }

    func savePrimaryArea(_ area: BodyArea) async throws(ProductFlowError) {}
    func acknowledgeSafetyBoundary() async throws(ProductFlowError) {}
    func completeOnboarding() async throws(ProductFlowError) -> BodyArea { .neck }

    func beginSingleAreaCheckIn() async throws(ProductFlowError) -> SingleAreaCheckInDraft {
        guard let day = LocalDay(rawValue: ProductFlowStubValues.day),
              let timeZone = NonEmptyString(rawValue: ProductFlowStubValues.timeZone),
              let calendar = NonEmptyString(rawValue: ProductFlowStubValues.calendar) else {
            throw .invalidData
        }
        return SingleAreaCheckInDraft(
            checkInID: checkInID,
            entryID: entryID,
            area: .neck,
            startedAt: ProductFlowStubValues.timestamp,
            dayContext: LocalDayContext(localDay: day, timeZoneID: timeZone, calendarID: calendar)
        )
    }

    func submitSingleAreaCheckIn(
        _ draft: SingleAreaCheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> SingleAreaCheckInResult {
        .plan(plan(checkInID: draft.checkInID, duration: .standard))
    }

    func revisePlan(
        checkInID: CheckInID,
        duration: DurationVariant,
        requestedLevel: RoutineLevel?
    ) async throws(ProductFlowError) -> PlanPresentation {
        plan(checkInID: checkInID, duration: duration)
    }

    func startRoutine(
        decisionID: SelectionDecisionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        RoutinePresentation(
            sessionID: sessionID,
            area: .neck,
            selectedLevel: .balanced,
            deliveredLevel: .balanced,
            duration: .quick,
            status: .inProgress,
            currentStepIndex: ProductFlowStubValues.firstStepIndex,
            totalStepCount: ProductFlowStubValues.stepCount,
            currentItem: nil
        )
    }

    func advanceRoutine(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int
    ) async throws(ProductFlowError) -> RoutinePresentation {
        RoutinePresentation(
            sessionID: sessionID,
            area: .neck,
            selectedLevel: .balanced,
            deliveredLevel: .balanced,
            duration: .quick,
            status: .completed,
            currentStepIndex: ProductFlowStubValues.stepCount,
            totalStepCount: ProductFlowStubValues.stepCount,
            currentItem: nil
        )
    }

    func submitFeedback(
        sessionID: RoutineSessionID,
        response: AreaResponse?
    ) async throws(ProductFlowError) {}

    private func plan(checkInID: CheckInID, duration: DurationVariant) -> PlanPresentation {
        PlanPresentation(
            decisionID: decisionID,
            checkInID: checkInID,
            area: .neck,
            recommendedLevel: .balanced,
            selectedLevel: .balanced,
            deliveredLevel: .balanced,
            duration: duration,
            explanationKeys: [.balancedCheckIn],
            itemCount: ProductFlowStubValues.stepCount,
            nominalSeconds: duration == .quick ?
                PrototypeCatalogDurations.quickNominalSeconds :
                PrototypeCatalogDurations.standardNominalSeconds,
            pauseTodayAvailable: false
        )
    }
}

private enum ProductFlowStubValues {
    static let day = "2026-08-17"
    static let timeZone = "America/Chicago"
    static let calendar = "gregorian"
    static let timestamp = TimestampMilliseconds(rawValue: 1_787_000_000_000)
    static let firstStepIndex = 0
    static let stepCount = 1
}
