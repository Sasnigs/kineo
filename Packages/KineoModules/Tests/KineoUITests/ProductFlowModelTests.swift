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
        #expect(model.state == .secondaryArea(primary: .neck, selected: nil))
        model.send(.continueSecondaryArea)
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

        model.send(.startCheckIn)
        await model.performPendingAction()
        guard case .checkInChange = model.state else {
            Issue.record("A same-day repeat must begin with a fresh check-in.")
            return
        }
    }

    @Test("Two-area check-in orders safety and saves independent feedback")
    func twoAreaScreenFlow() async throws {
        let service = ProductFlowServiceStub(
            productStartState: .today(.neck),
            secondaryArea: .lowerBack
        )
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.startCheckIn)
        await model.performPendingAction()

        #expect(model.currentCheckInArea == .neck)
        model.send(.selectChange(.similar))
        model.send(.selectComfort(.okay))
        await model.performPendingAction()
        #expect(model.currentCheckInArea == .lowerBack)
        #expect(model.canSkipSecondaryArea)
        model.send(.selectChange(.worse))
        #expect(!model.canSkipSecondaryArea)
        model.send(.selectComfort(.okay))
        await model.performPendingAction()
        guard case .conditionalSafety = model.state else {
            Issue.record("Expected the secondary safety question.")
            return
        }
        model.send(.answerConditionalSafety(.no))
        await model.performPendingAction()
        guard case .plan(let plan) = model.state else {
            Issue.record("Expected a two-area plan.")
            return
        }
        #expect(plan.includedAreas == [.neck, .lowerBack])

        model.send(.startRoutine)
        await model.performPendingAction()
        model.send(.advanceRoutine)
        await model.performPendingAction()
        model.send(.selectFeedback(.neck, .better))
        model.send(.selectFeedback(.lowerBack, .same))
        model.send(.submitAreaFeedback)
        await model.performPendingAction()
        #expect(await service.feedbackSnapshot() == [.neck: .better, .lowerBack: .same])
    }

    @Test("Two triggered areas ask safety in primary-then-secondary order")
    func twoAreaSafetyOrder() async {
        let service = ProductFlowServiceStub(
            productStartState: .today(.neck),
            secondaryArea: .lowerBack
        )
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.startCheckIn)
        await model.performPendingAction()
        model.send(.selectChange(.worse))
        model.send(.selectComfort(.okay))
        await model.performPendingAction()

        #expect(model.currentCheckInArea == .lowerBack)
        model.send(.selectChange(.worse))
        model.send(.selectComfort(.limited))
        await model.performPendingAction()
        #expect(model.currentCheckInArea == .neck)
        model.send(.answerConditionalSafety(.no))
        await model.performPendingAction()
        #expect(model.currentCheckInArea == .lowerBack)
        model.send(.answerConditionalSafety(.no))
        await model.performPendingAction()
        guard case .plan = model.state else {
            Issue.record("Expected a plan only after both ordered safety answers.")
            return
        }
    }

    @Test("Skipping a secondary cannot bypass a pending primary safety answer")
    func secondarySkipCannotBypassSafety() async {
        let service = ProductFlowServiceStub(
            productStartState: .today(.neck),
            secondaryArea: .upperMidBack
        )
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.startCheckIn)
        await model.performPendingAction()
        model.send(.selectChange(.worse))
        model.send(.selectComfort(.okay))
        await model.performPendingAction()
        model.send(.skipSecondaryArea)
        await model.performPendingAction()

        guard case .conditionalSafety = model.state else {
            Issue.record("Skipping secondary must retain the primary safety question.")
            return
        }
        #expect(model.currentCheckInArea == .neck)
    }

    @Test("Dashboard preferences, reminders, Reset, and Delete use committed projections")
    func dashboardAndDataControls() async {
        let service = ProductFlowServiceStub(productStartState: .today(.neck))
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.loadDashboard)
        await model.performPendingAction()
        #expect(model.progress?.isEmpty == true)
        #expect(model.profile?.primaryArea == .neck)
        #expect(model.profile?.healthContextEnabled == false)
        #expect(model.profile?.telemetryEnabled == false)

        model.send(.selectProfilePrimary(.upperMidBack))
        model.send(.selectProfileSecondary(.lowerBack))
        model.send(.saveProfileAreas)
        await model.performPendingAction()
        #expect(model.profile?.primaryArea == .upperMidBack)
        #expect(model.profile?.secondaryArea == .lowerBack)

        model.send(.enableReminder(.morning))
        await model.performPendingAction()
        #expect(model.profile?.reminderSettings?.enabled == true)
        model.send(.disableReminder)
        await model.performPendingAction()
        #expect(model.profile?.reminderSettings == nil)

        model.send(.requestResetHistory)
        #expect(model.state == .resetHistoryConfirmation(.upperMidBack))
        model.send(.confirmResetHistory)
        await model.performPendingAction()
        #expect(model.state == .today(.upperMidBack))
        #expect(await service.dataControlSnapshot().0)

        model.send(.requestDeleteAll)
        #expect(model.state == .deleteAllConfirmation(.upperMidBack))
        model.send(.confirmDeleteAll)
        await model.performPendingAction()
        #expect(model.state == .welcome)
        #expect(await service.dataControlSnapshot().1)
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

    @Test("Attention return and correction require a committed clear before Today")
    func attentionCorrectionFlow() async {
        let prompt = AttentionPrompt(
            area: .neck,
            responseEventID: SafetyEventID(UUID()),
            expectedAttentionUpdatedAt: ProductFlowStubValues.timestamp
        )
        let service = ProductFlowServiceStub(productStartState: .attentionRequired(prompt))
        let model = ProductFlowModel(service: service)

        await model.performPendingAction()
        #expect(model.state == .attentionReturn(prompt))
        model.send(.answerAttentionReturn(.no))
        await model.performPendingAction()
        #expect(model.state == .attentionGuidance(prompt))
        model.send(.showAttentionReturn)
        #expect(model.state == .attentionReturn(prompt))

        model.send(.startAttentionCorrection)
        await model.performPendingAction()
        guard case .attentionCorrectionChange = model.state else {
            Issue.record("Expected a fresh correction check-in.")
            return
        }
        model.send(.selectCorrectionChange(.similar))
        model.send(.selectCorrectionComfort(.okay))
        await model.performPendingAction()
        #expect(model.state == .today(.neck))
    }

    @Test("An eligible plan can Pause Today without starting a routine")
    func pauseTodayFlow() async throws {
        let service = ProductFlowServiceStub(pauseTodayAvailable: true)
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.getStarted)
        model.send(.confirmAdult)
        await model.performPendingAction()
        model.send(.selectPrimaryArea(.neck))
        model.send(.continuePrimaryArea)
        await model.performPendingAction()
        model.send(.continueSecondaryArea)
        await model.performPendingAction()
        model.send(.acknowledgeSafety)
        await model.performPendingAction()
        model.send(.completeOnboarding)
        await model.performPendingAction()
        model.send(.startCheckIn)
        await model.performPendingAction()
        model.send(.selectChange(.similar))
        model.send(.selectComfort(.okay))
        await model.performPendingAction()

        model.send(.pauseToday)
        await model.performPendingAction()
        #expect(model.state == .pauseTodayConfirmation(.neck))
        model.send(.finishPauseToday)
        #expect(model.state == .today(.neck))
    }

    @Test("A stale Today route fails closed into the current Attention prompt")
    func attentionPreflightRecovery() async {
        let prompt = AttentionPrompt(
            area: .lowerBack,
            responseEventID: SafetyEventID(UUID()),
            expectedAttentionUpdatedAt: ProductFlowStubValues.timestamp
        )
        let service = ProductFlowServiceStub(
            productStartStates: [.today(.neck), .attentionRequired(prompt)],
            failBeginCheckInWithAttention: true
        )
        let model = ProductFlowModel(service: service)

        await model.performPendingAction()
        #expect(model.state == .today(.neck))
        model.send(.startCheckIn)
        await model.performPendingAction()
        #expect(model.state == .attentionReturn(prompt))
        #expect(model.errorMessage == nil)
    }

    @Test("Routine pause, lifecycle, end, and safety controls never auto-resume")
    func routineControlFlow() async {
        let service = ProductFlowServiceStub()
        let model = ProductFlowModel(service: service)
        await model.performPendingAction()
        model.send(.getStarted)
        model.send(.confirmAdult)
        await model.performPendingAction()
        model.send(.selectPrimaryArea(.neck))
        model.send(.continuePrimaryArea)
        await model.performPendingAction()
        model.send(.continueSecondaryArea)
        await model.performPendingAction()
        model.send(.acknowledgeSafety)
        await model.performPendingAction()
        model.send(.completeOnboarding)
        await model.performPendingAction()
        model.send(.startCheckIn)
        await model.performPendingAction()
        model.send(.selectChange(.similar))
        model.send(.selectComfort(.okay))
        await model.performPendingAction()
        model.send(.startRoutine)
        await model.performPendingAction()

        await model.pauseActiveRoutineForLifecycle()
        guard case .routine(let backgroundPaused) = model.state else {
            Issue.record("Backgrounding must leave a paused routine.")
            return
        }
        #expect(backgroundPaused.status == .paused)
        model.send(.resumeRoutine)
        await model.performPendingAction()
        model.send(.requestEndRoutine)
        await model.performPendingAction()
        guard case .endConfirmation(let endPaused) = model.state else {
            Issue.record("End must pause before confirmation.")
            return
        }
        #expect(endPaused.status == .paused)
        model.send(.cancelRoutineModal)
        guard case .routine(let cancelledEnd) = model.state else {
            Issue.record("Cancelling End must remain paused.")
            return
        }
        #expect(cancelledEnd.status == .paused)

        model.send(.resumeRoutine)
        await model.performPendingAction()
        model.send(.somethingFeelsWrong)
        await model.performPendingAction()
        guard case .safetyGuidance(let safetyPaused) = model.state else {
            Issue.record("The safety control must pause before guidance.")
            return
        }
        #expect(safetyPaused.status == .paused)
        model.send(.safetyTappedByMistake)
        guard case .routine(let mistakenTap) = model.state else {
            Issue.record("An accidental safety tap must return to the paused routine.")
            return
        }
        #expect(mistakenTap.status == .paused)

        model.send(.resumeRoutine)
        await model.performPendingAction()
        model.send(.somethingFeelsWrong)
        await model.performPendingAction()
        model.send(.confirmSafetyEnd)
        await model.performPendingAction()
        guard case .feedback(let ended) = model.state else {
            Issue.record("A confirmed safety end must continue to optional feedback.")
            return
        }
        #expect(ended.status == .safetyStopped)
    }
}

private actor ProductFlowServiceStub: KineoProductServing {
    private var failAdultConfirmationOnce: Bool
    private var launchStates: [AppLaunchState]
    private var productStartStates: [ProductStartState]
    private let pauseTodayAvailable: Bool
    private let failBeginCheckInWithAttention: Bool
    private let secondaryArea: BodyArea?
    private var submittedFeedback = [BodyArea: AreaResponse]()
    private var progressProjection = ProgressPresentation(areas: [], participationDayCount: 0)
    private var profileProjection: ProfilePresentation
    private var resetWasCalled = false
    private var deleteWasCalled = false
    private let checkInID = CheckInID(UUID())
    private let entryID = CheckInEntryID(UUID())
    private let decisionID = SelectionDecisionID(UUID())
    private let sessionID = RoutineSessionID(UUID())

    init(
        failAdultConfirmationOnce: Bool = false,
        launchStates: [AppLaunchState] = [.foundationReady],
        productStartState: ProductStartState = .onboarding(.welcome),
        productStartStates: [ProductStartState]? = nil,
        pauseTodayAvailable: Bool = false,
        failBeginCheckInWithAttention: Bool = false,
        secondaryArea: BodyArea? = nil
    ) {
        self.failAdultConfirmationOnce = failAdultConfirmationOnce
        self.launchStates = launchStates
        self.productStartStates = productStartStates ?? [productStartState]
        self.pauseTodayAvailable = pauseTodayAvailable
        self.failBeginCheckInWithAttention = failBeginCheckInWithAttention
        self.secondaryArea = secondaryArea
        profileProjection = ProfilePresentation(
            primaryArea: .neck,
            secondaryArea: secondaryArea,
            reminderSettings: nil,
            reminderAuthorization: .notDetermined,
            healthContextEnabled: false,
            telemetryEnabled: false
        )
    }

    func initialState() async -> AppLaunchState {
        guard !launchStates.isEmpty else { return .foundationReady }
        return launchStates.removeFirst()
    }

    func loadProductStartState() async throws(ProductFlowError) -> ProductStartState {
        guard let first = productStartStates.first else { throw .invalidState }
        if productStartStates.count > ProductFlowStubValues.singleRemainingStateCount {
            productStartStates.removeFirst()
        }
        return first
    }

    func confirmAdultEligibility() async throws(ProductFlowError) {
        if failAdultConfirmationOnce {
            failAdultConfirmationOnce = false
            throw .persistence(.writeFailed)
        }
    }

    func savePrimaryArea(_ area: BodyArea) async throws(ProductFlowError) {}
    func saveSecondaryArea(_ area: BodyArea?) async throws(ProductFlowError) {}
    func acknowledgeSafetyBoundary() async throws(ProductFlowError) {}
    func completeOnboarding() async throws(ProductFlowError) -> BodyArea { .neck }

    func respondToAttentionReturn(
        _ prompt: AttentionPrompt,
        answer: ConditionalSafetyAnswer
    ) async throws(ProductFlowError) -> AttentionResolution {
        answer == .yes ? .ready(.neck) : .attentionRequired(prompt)
    }

    func beginAttentionCorrection(
        _ prompt: AttentionPrompt
    ) async throws(ProductFlowError) -> AttentionCorrectionDraft {
        AttentionCorrectionDraft(
            checkIn: try await beginCheckIn(),
            safetyEventID: SafetyEventID(UUID()),
            expectedAttentionUpdatedAt: prompt.expectedAttentionUpdatedAt
        )
    }

    func submitAttentionCorrection(
        _ draft: AttentionCorrectionDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> AttentionResolution {
        .ready(draft.checkIn.area)
    }

    func beginCheckIn() async throws(ProductFlowError) -> CheckInDraft {
        if failBeginCheckInWithAttention {
            throw .attentionRequired([.lowerBack])
        }
        guard let day = LocalDay(rawValue: ProductFlowStubValues.day),
              let timeZone = NonEmptyString(rawValue: ProductFlowStubValues.timeZone),
              let calendar = NonEmptyString(rawValue: ProductFlowStubValues.calendar) else {
            throw .invalidData
        }
        return CheckInDraft(
            checkInID: checkInID,
            entryID: entryID,
            area: .neck,
            secondaryEntryID: secondaryArea.map { _ in CheckInEntryID(UUID()) },
            secondaryArea: secondaryArea,
            startedAt: ProductFlowStubValues.timestamp,
            dayContext: LocalDayContext(localDay: day, timeZoneID: timeZone, calendarID: calendar)
        )
    }

    func submitPrimaryOnlyCheckIn(
        _ draft: CheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> CheckInResult {
        .plan(plan(checkInID: draft.checkInID, duration: .standard))
    }

    func submitCheckIn(
        _ draft: CheckInDraft,
        primary: AreaCheckInAnswers,
        secondary: AreaCheckInAnswers?
    ) async throws(ProductFlowError) -> CheckInResult {
        .plan(plan(checkInID: draft.checkInID, duration: .standard))
    }

    func revisePlan(
        checkInID: CheckInID,
        duration: DurationVariant,
        requestedLevel: RoutineLevel?
    ) async throws(ProductFlowError) -> PlanPresentation {
        plan(checkInID: checkInID, duration: duration)
    }

    func pauseToday(checkInID: CheckInID) async throws(ProductFlowError) -> BodyArea {
        .neck
    }

    func startRoutine(
        decisionID: SelectionDecisionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        RoutinePresentation(
            sessionID: sessionID,
            area: .neck,
            includedAreas: [.neck, secondaryArea].compactMap { $0 },
            selectedLevel: .balanced,
            deliveredLevel: .balanced,
            duration: .quick,
            status: .inProgress,
            currentStepIndex: ProductFlowStubValues.firstStepIndex,
            totalStepCount: ProductFlowStubValues.stepCount,
            currentItem: nil
        )
    }

    func refreshRoutine(
        sessionID: RoutineSessionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        try routine(status: .inProgress)
    }

    func pauseRoutine(
        sessionID: RoutineSessionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        try routine(status: .paused)
    }

    func resumeRoutine(
        sessionID: RoutineSessionID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        try routine(status: .inProgress)
    }

    func skipRoutineStep(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int,
        reason: RoutineEventReason?
    ) async throws(ProductFlowError) -> RoutinePresentation {
        try routine(status: .completed)
    }

    func selectRoutineAlternative(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int,
        movementID: CatalogID
    ) async throws(ProductFlowError) -> RoutinePresentation {
        try routine(status: .paused)
    }

    func endRoutine(
        sessionID: RoutineSessionID,
        forSafety: Bool
    ) async throws(ProductFlowError) -> RoutinePresentation {
        try routine(status: forSafety ? .safetyStopped : .stopped)
    }

    func advanceRoutine(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int
    ) async throws(ProductFlowError) -> RoutinePresentation {
        RoutinePresentation(
            sessionID: sessionID,
            area: .neck,
            includedAreas: [.neck, secondaryArea].compactMap { $0 },
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

    func submitFeedback(
        sessionID: RoutineSessionID,
        responses: [BodyArea: AreaResponse]
    ) async throws(ProductFlowError) {
        submittedFeedback = responses
    }

    func feedbackSnapshot() -> [BodyArea: AreaResponse] { submittedFeedback }

    func loadProgress() async throws(ProductFlowError) -> ProgressPresentation {
        progressProjection
    }

    func loadProfile() async throws(ProductFlowError) -> ProfilePresentation {
        profileProjection
    }

    func saveAreaPreferences(
        primary: BodyArea,
        secondary: BodyArea?
    ) async throws(ProductFlowError) -> ProfilePresentation {
        profileProjection = profile(primary: primary, secondary: secondary)
        return profileProjection
    }

    func enableReminder(window: ReminderWindow) async throws(ProductFlowError) -> ProfilePresentation {
        guard let timeZone = NonEmptyString(rawValue: ProductFlowStubValues.timeZone) else {
            throw .invalidData
        }
        let settings: ReminderSettings
        do {
            settings = try ReminderSettings(
                enabled: true,
                window: window,
                timeZoneID: timeZone,
                updatedAt: ProductFlowStubValues.timestamp
            )
        } catch {
            throw .invalidData
        }
        profileProjection = ProfilePresentation(
            primaryArea: profileProjection.primaryArea,
            secondaryArea: profileProjection.secondaryArea,
            reminderSettings: settings,
            reminderAuthorization: .authorized,
            healthContextEnabled: false,
            telemetryEnabled: false
        )
        return profileProjection
    }

    func disableReminder() async throws(ProductFlowError) -> ProfilePresentation {
        profileProjection = profile(
            primary: profileProjection.primaryArea,
            secondary: profileProjection.secondaryArea
        )
        return profileProjection
    }
    func resetHistory() async throws(ProductFlowError) {
        resetWasCalled = true
        progressProjection = ProgressPresentation(areas: [], participationDayCount: 0)
    }
    func deleteAllData() async throws(ProductFlowError) { deleteWasCalled = true }

    func dataControlSnapshot() -> (Bool, Bool) { (resetWasCalled, deleteWasCalled) }

    private func routine(status: RoutineStatus) throws(ProductFlowError) -> RoutinePresentation {
        RoutinePresentation(
            sessionID: sessionID,
            area: .neck,
            includedAreas: [.neck, secondaryArea].compactMap { $0 },
            selectedLevel: .balanced,
            deliveredLevel: .balanced,
            duration: .quick,
            status: status,
            currentStepIndex: ProductFlowStubValues.firstStepIndex,
            totalStepCount: ProductFlowStubValues.stepCount,
            currentItem: nil
        )
    }

    private func plan(checkInID: CheckInID, duration: DurationVariant) -> PlanPresentation {
        PlanPresentation(
            decisionID: decisionID,
            checkInID: checkInID,
            area: .neck,
            includedAreas: [.neck, secondaryArea].compactMap { $0 },
            recommendedLevel: .balanced,
            selectedLevel: .balanced,
            deliveredLevel: .balanced,
            duration: duration,
            explanationKeys: [.balancedCheckIn],
            itemCount: ProductFlowStubValues.stepCount,
            nominalSeconds: duration == .quick ?
                PrototypeCatalogDurations.quickNominalSeconds :
                PrototypeCatalogDurations.standardNominalSeconds,
            pauseTodayAvailable: pauseTodayAvailable
        )
    }

    private func profile(
        primary: BodyArea = .neck,
        secondary: BodyArea? = nil
    ) -> ProfilePresentation {
        ProfilePresentation(
            primaryArea: primary,
            secondaryArea: secondary,
            reminderSettings: nil,
            reminderAuthorization: .notDetermined,
            healthContextEnabled: false,
            telemetryEnabled: false
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
    static let singleRemainingStateCount = 1
}
