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
    case safetyBoundary(BodyArea)
    case firstCheckIn(BodyArea)
}

/// The product route reconstructed after launch.
public enum ProductStartState: Equatable, Sendable {
    case onboarding(OnboardingProgress)
    case attentionRequired(AttentionPrompt)
    case today(BodyArea)
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
public struct SingleAreaCheckInDraft: Equatable, Sendable {
    public let checkInID: CheckInID
    public let entryID: CheckInEntryID
    public let area: BodyArea
    public let startedAt: TimestampMilliseconds
    public let dayContext: LocalDayContext

    public init(
        checkInID: CheckInID,
        entryID: CheckInEntryID,
        area: BodyArea,
        startedAt: TimestampMilliseconds,
        dayContext: LocalDayContext
    ) {
        self.checkInID = checkInID
        self.entryID = entryID
        self.area = area
        self.startedAt = startedAt
        self.dayContext = dayContext
    }
}

/// Stable identities and safety version for one fresh Attention correction.
public struct AttentionCorrectionDraft: Equatable, Sendable {
    public let checkIn: SingleAreaCheckInDraft
    public let safetyEventID: SafetyEventID
    public let expectedAttentionUpdatedAt: TimestampMilliseconds

    public init(
        checkIn: SingleAreaCheckInDraft,
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
public enum SingleAreaCheckInResult: Equatable, Sendable {
    case attentionRequired(AttentionPrompt)
    case plan(PlanPresentation)
}

/// Current durable routine position and its frozen presentation.
public struct RoutinePresentation: Equatable, Sendable {
    public let sessionID: RoutineSessionID
    public let area: BodyArea
    public let selectedLevel: RoutineLevel
    public let deliveredLevel: RoutineLevel
    public let duration: DurationVariant
    public let status: RoutineStatus
    public let currentStepIndex: Int
    public let totalStepCount: Int
    public let currentItem: PresentedRoutineItem?

    public init(
        sessionID: RoutineSessionID,
        area: BodyArea,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel,
        duration: DurationVariant,
        status: RoutineStatus,
        currentStepIndex: Int,
        totalStepCount: Int,
        currentItem: PresentedRoutineItem?
    ) {
        self.sessionID = sessionID
        self.area = area
        self.selectedLevel = selectedLevel
        self.deliveredLevel = deliveredLevel
        self.duration = duration
        self.status = status
        self.currentStepIndex = currentStepIndex
        self.totalStepCount = totalStepCount
        self.currentItem = currentItem
    }
}

/// The functional product operations used by the SwiftUI product flow.
public protocol KineoProductServing: AppBootstrapping {
    func loadProductStartState() async throws(ProductFlowError) -> ProductStartState
    func confirmAdultEligibility() async throws(ProductFlowError)
    func savePrimaryArea(_ area: BodyArea) async throws(ProductFlowError)
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
    func beginSingleAreaCheckIn() async throws(ProductFlowError) -> SingleAreaCheckInDraft
    func submitSingleAreaCheckIn(
        _ draft: SingleAreaCheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        safetyAnswer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) -> SingleAreaCheckInResult
    func revisePlan(
        checkInID: CheckInID,
        duration: DurationVariant,
        requestedLevel: RoutineLevel?
    ) async throws(ProductFlowError) -> PlanPresentation
    func pauseToday(checkInID: CheckInID) async throws(ProductFlowError) -> BodyArea
    func startRoutine(decisionID: SelectionDecisionID) async throws(ProductFlowError) -> RoutinePresentation
    func advanceRoutine(
        sessionID: RoutineSessionID,
        expectedStepIndex: Int
    ) async throws(ProductFlowError) -> RoutinePresentation
    func submitFeedback(
        sessionID: RoutineSessionID,
        response: AreaResponse?
    ) async throws(ProductFlowError)
}
