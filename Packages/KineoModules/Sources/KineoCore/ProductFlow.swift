/// A timestamp and local-calendar context captured together for one operation.
public struct ProductMoment: Equatable, Sendable {
    public let timestamp: TimestampMilliseconds
    public let dayContext: LocalDayContext

    public init(timestamp: TimestampMilliseconds, dayContext: LocalDayContext) {
        self.timestamp = timestamp
        self.dayContext = dayContext
    }
}

/// Supplies deterministic time to application use cases.
public protocol ProductClock: Sendable {
    func now() -> ProductMoment?
}

/// Failures exposed by the product-flow boundary.
public enum ProductFlowError: Error, Equatable, Sendable {
    case foundationNotReady
    case invalidState
    case attentionRequired([BodyArea])
    case contentUnavailable
    case invalidData
    case persistence(PersistenceError)
}

/// Durable onboarding progress reconstructed from the local store.
public enum OnboardingProgress: Equatable, Sendable {
    case welcome
    case primaryArea
    case secondaryArea(primary: BodyArea, selected: BodyArea?)
    case safetyBoundary(BodyArea)
    case firstCheckIn(BodyArea)
}

/// The product route reconstructed after launch.
public enum ProductStartState: Equatable, Sendable {
    case onboarding(OnboardingProgress)
    case attentionRequired(AttentionPrompt)
    case unfinishedCheckIn(CheckInDraft)
    case unfinishedPlan(PlanPresentation)
    case unfinishedRoutine(RoutinePresentation)
    case today(BodyArea)
}

/// Supplies monotonic elapsed time for guided-routine timing.
public protocol RoutineMonotonicClock: Sendable {
    func nowMilliseconds() async -> Int64?
}

/// One immutable attempt to answer the return-to-usual Attention prompt.
public struct AttentionPrompt: Equatable, Sendable {
    public let area: BodyArea
    public let responseEventID: SafetyEventID
    public let expectedAttentionUpdatedAt: TimestampMilliseconds

    public init(
        area: BodyArea,
        responseEventID: SafetyEventID,
        expectedAttentionUpdatedAt: TimestampMilliseconds
    ) {
        self.area = area
        self.responseEventID = responseEventID
        self.expectedAttentionUpdatedAt = expectedAttentionUpdatedAt
    }
}

/// The next safe route after an Attention return answer or correction commits.
public enum AttentionResolution: Equatable, Sendable {
    case attentionRequired(AttentionPrompt)
    case ready(BodyArea)
}

/// Stable identity and context for one in-progress single-area check-in.
public struct CheckInDraft: Equatable, Sendable {
    public let checkInID: CheckInID
    public let entryID: CheckInEntryID
    public let area: BodyArea
    public let secondaryEntryID: CheckInEntryID?
    public let secondaryArea: BodyArea?
    public let startedAt: TimestampMilliseconds
    public let dayContext: LocalDayContext

    public init(
        checkInID: CheckInID,
        entryID: CheckInEntryID,
        area: BodyArea,
        secondaryEntryID: CheckInEntryID? = nil,
        secondaryArea: BodyArea? = nil,
        startedAt: TimestampMilliseconds,
        dayContext: LocalDayContext
    ) {
        self.checkInID = checkInID
        self.entryID = entryID
        self.area = area
        self.secondaryEntryID = secondaryEntryID
        self.secondaryArea = secondaryArea
        self.startedAt = startedAt
        self.dayContext = dayContext
    }
}

/// Complete answers for one included area in a check-in commit.
public struct AreaCheckInAnswers: Equatable, Sendable {
    public let area: BodyArea
    public let change: ChangeReport
    public let comfort: MovementComfort
    public let safetyAnswer: ConditionalSafetyAnswer?

    public init(
        area: BodyArea,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) {
        self.area = area
        self.change = change
        self.comfort = comfort
        self.safetyAnswer = safetyAnswer
    }

    public var requiresSafetyAnswer: Bool {
        change == .worse || comfort == .limited
    }
}

/// Stable identities and safety version for one fresh Attention correction.
public struct AttentionCorrectionDraft: Equatable, Sendable {
    public let checkIn: CheckInDraft
    public let safetyEventID: SafetyEventID
    public let expectedAttentionUpdatedAt: TimestampMilliseconds

    public init(
        checkIn: CheckInDraft,
        safetyEventID: SafetyEventID,
        expectedAttentionUpdatedAt: TimestampMilliseconds
    ) {
        self.checkIn = checkIn
        self.safetyEventID = safetyEventID
        self.expectedAttentionUpdatedAt = expectedAttentionUpdatedAt
    }
}

/// User-visible facts from one committed plan revision.
public struct PlanPresentation: Equatable, Sendable {
    public let decisionID: SelectionDecisionID
    public let checkInID: CheckInID
    public let area: BodyArea
    public let includedAreas: [BodyArea]
    public let omittedSecondaryArea: BodyArea?
    public let recommendedLevel: RoutineLevel
    public let selectedLevel: RoutineLevel
    public let deliveredLevel: RoutineLevel
    public let duration: DurationVariant
    public let explanationKeys: [SelectionExplanationKey]
    public let itemCount: Int
    public let nominalSeconds: Int
    public let pauseTodayAvailable: Bool

    public init(
        decisionID: SelectionDecisionID,
        checkInID: CheckInID,
        area: BodyArea,
        includedAreas: [BodyArea]? = nil,
        omittedSecondaryArea: BodyArea? = nil,
        recommendedLevel: RoutineLevel,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel,
        duration: DurationVariant,
        explanationKeys: [SelectionExplanationKey],
        itemCount: Int,
        nominalSeconds: Int,
        pauseTodayAvailable: Bool
    ) {
        self.decisionID = decisionID
        self.checkInID = checkInID
        self.area = area
        self.includedAreas = includedAreas ?? [area]
        self.omittedSecondaryArea = omittedSecondaryArea
        self.recommendedLevel = recommendedLevel
        self.selectedLevel = selectedLevel
        self.deliveredLevel = deliveredLevel
        self.duration = duration
        self.explanationKeys = explanationKeys
        self.itemCount = itemCount
        self.nominalSeconds = nominalSeconds
        self.pauseTodayAvailable = pauseTodayAvailable
    }
}

/// Result after a complete check-in commits.
public enum CheckInResult: Equatable, Sendable {
    case attentionRequired(AttentionPrompt)
    case plan(PlanPresentation)
}

/// Current durable routine position and its frozen presentation.
public struct RoutinePresentation: Equatable, Sendable {
    public let sessionID: RoutineSessionID
    public let area: BodyArea
    public let includedAreas: [BodyArea]
    public let selectedLevel: RoutineLevel
    public let deliveredLevel: RoutineLevel
    public let duration: DurationVariant
    public let status: RoutineStatus
    public let currentStepIndex: Int
    public let totalStepCount: Int
    public let currentItem: PresentedRoutineItem?
    public let selectedAlternative: PresentedAlternative?
    public let stepElapsedMilliseconds: Int64
    public let contentAvailable: Bool

    public init(
        sessionID: RoutineSessionID,
        area: BodyArea,
        includedAreas: [BodyArea]? = nil,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel,
        duration: DurationVariant,
        status: RoutineStatus,
        currentStepIndex: Int,
        totalStepCount: Int,
        currentItem: PresentedRoutineItem?,
        selectedAlternative: PresentedAlternative? = nil,
        stepElapsedMilliseconds: Int64 = 0,
        contentAvailable: Bool = true
    ) {
        self.sessionID = sessionID
        self.area = area
        self.includedAreas = includedAreas ?? [area]
        self.selectedLevel = selectedLevel
        self.deliveredLevel = deliveredLevel
        self.duration = duration
        self.status = status
        self.currentStepIndex = currentStepIndex
        self.totalStepCount = totalStepCount
        self.currentItem = currentItem
        self.selectedAlternative = selectedAlternative
        self.stepElapsedMilliseconds = stepElapsedMilliseconds
        self.contentAvailable = contentAvailable
    }
}

/// The functional product operations used by the SwiftUI product flow.
public protocol KineoProductServing: AppBootstrapping {
    func loadProductStartState() async throws(ProductFlowError) -> ProductStartState
    func confirmAdultEligibility() async throws(ProductFlowError)
    func savePrimaryArea(_ area: BodyArea) async throws(ProductFlowError)
    func saveSecondaryArea(_ area: BodyArea?) async throws(ProductFlowError)
    func acknowledgeSafetyBoundary() async throws(ProductFlowError)
    func completeOnboarding() async throws(ProductFlowError) -> BodyArea
    func respondToAttentionReturn(
        _ prompt: AttentionPrompt,
        answer: ConditionalSafetyAnswer
    ) async throws(ProductFlowError) -> AttentionResolution
    func beginAttentionCorrection(
        _ prompt: AttentionPrompt
    ) async throws(ProductFlowError) -> AttentionCorrectionDraft
    func submitAttentionCorrection(
        _ draft: AttentionCorrectionDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> AttentionResolution
    func beginCheckIn() async throws(ProductFlowError) -> CheckInDraft
    func submitPrimaryOnlyCheckIn(
        _ draft: CheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> CheckInResult
    func submitCheckIn(
        _ draft: CheckInDraft,
        primary: AreaCheckInAnswers,
        secondary: AreaCheckInAnswers?
    ) async throws(ProductFlowError) -> CheckInResult
    func revisePlan(
        checkInID: CheckInID,
        duration: DurationVariant,
        requestedLevel: RoutineLevel?
    ) async throws(ProductFlowError) -> PlanPresentation
    func pauseToday(checkInID: CheckInID) async throws(ProductFlowError) -> BodyArea
    func startRoutine(decisionID: SelectionDecisionID) async throws(ProductFlowError) -> RoutinePresentation
    func refreshRoutine(sessionID: RoutineSessionID) async throws(ProductFlowError) -> RoutinePresentation
    func pauseRoutine(sessionID: RoutineSessionID) async throws(ProductFlowError) -> RoutinePresentation
    func resumeRoutine(sessionID: RoutineSessionID) async throws(ProductFlowError) -> RoutinePresentation
    func skipRoutineStep(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int,
        reason: RoutineEventReason?
    ) async throws(ProductFlowError) -> RoutinePresentation
    func selectRoutineAlternative(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int,
        movementID: CatalogID
    ) async throws(ProductFlowError) -> RoutinePresentation
    func endRoutine(
        sessionID: RoutineSessionID,
        forSafety: Bool
    ) async throws(ProductFlowError) -> RoutinePresentation
    func advanceRoutine(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int
    ) async throws(ProductFlowError) -> RoutinePresentation
    func submitFeedback(
        sessionID: RoutineSessionID,
        response: AreaResponse?
    ) async throws(ProductFlowError)
    func submitFeedback(
        sessionID: RoutineSessionID,
        responses: [BodyArea: AreaResponse]
    ) async throws(ProductFlowError)
}
