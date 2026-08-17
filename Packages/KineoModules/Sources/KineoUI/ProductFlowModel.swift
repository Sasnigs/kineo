import KineoCore
import Observation

enum ProductScreenState: Equatable {
    case launching(AppLaunchState)
    case welcome
    case ageConfirmation
    case ageUnavailable
    case primaryArea(BodyArea?)
    case safetyBoundary(BodyArea)
    case firstCheckIn(BodyArea)
    case today(BodyArea)
    case checkInChange(SingleAreaCheckInDraft)
    case checkInComfort(SingleAreaCheckInDraft, ChangeReport)
    case conditionalSafety(SingleAreaCheckInDraft, ChangeReport, MovementComfort)
    case attentionRequired(BodyArea)
    case plan(PlanPresentation)
    case routine(RoutinePresentation)
    case feedback(RoutinePresentation)
    case completion(BodyArea)
}

enum ProductFlowAction: Equatable {
    case load
    case getStarted
    case confirmAdult
    case underAge
    case correctAge
    case selectPrimaryArea(BodyArea)
    case continuePrimaryArea
    case acknowledgeSafety
    case completeOnboarding
    case startCheckIn
    case selectChange(ChangeReport)
    case selectComfort(MovementComfort)
    case answerConditionalSafety(ConditionalSafetyAnswer)
    case chooseDuration(DurationVariant)
    case chooseGentlerLevel(RoutineLevel)
    case startRoutine
    case advanceRoutine
    case submitFeedback(AreaResponse?)
    case finishCompletion
    case retry
}

@Observable @MainActor
final class ProductFlowModel {
    private let service: any KineoProductServing
    private var pendingAction: ProductFlowAction?
    private var failedAction: ProductFlowAction?

    private(set) var state: ProductScreenState = .launching(.preparingFoundation)
    private(set) var actionSequence = ProductFlowModelConstants.initialActionSequence
    private(set) var isSubmitting = false
    private(set) var errorMessage: String?

    init(service: any KineoProductServing) {
        self.service = service
        send(.load)
    }

    func send(_ action: ProductFlowAction) {
        guard !isSubmitting else { return }
        if applySynchronous(action) { return }
        pendingAction = action
        actionSequence += ProductFlowModelConstants.actionSequenceIncrement
    }

    func performPendingAction() async {
        guard let action = pendingAction else { return }
        pendingAction = nil
        isSubmitting = true
        errorMessage = nil
        do {
            try await perform(action)
            failedAction = nil
        } catch {
            failedAction = action
            handle(error)
        }
        isSubmitting = false
    }

    private func applySynchronous(_ action: ProductFlowAction) -> Bool {
        switch action {
        case .getStarted where state == .welcome:
            state = .ageConfirmation
        case .underAge where state == .ageConfirmation:
            state = .ageUnavailable
        case .correctAge where state == .ageUnavailable:
            state = .ageConfirmation
        case .selectPrimaryArea(let area):
            guard case .primaryArea = state else { return true }
            state = .primaryArea(area)
        case .selectChange(let change):
            guard case .checkInChange(let draft) = state else { return true }
            state = .checkInComfort(draft, change)
        case .finishCompletion:
            guard case .completion(let area) = state else { return true }
            state = .today(area)
        case .load, .confirmAdult, .continuePrimaryArea, .acknowledgeSafety,
             .completeOnboarding, .startCheckIn, .selectComfort,
             .answerConditionalSafety, .chooseDuration, .chooseGentlerLevel,
             .startRoutine, .advanceRoutine, .submitFeedback, .retry:
            return false
        default:
            return true
        }
        return true
    }

    private func perform(_ action: ProductFlowAction) async throws(ProductFlowError) {
        switch action {
        case .load:
            let launch = await service.initialState()
            state = .launching(launch)
            guard launch == .foundationReady else { return }
            try await routeToProductStart()
        case .confirmAdult:
            guard state == .ageConfirmation else { throw .invalidState }
            try await service.confirmAdultEligibility()
            state = .primaryArea(nil)
        case .continuePrimaryArea:
            guard case .primaryArea(let selected) = state, let selected else {
                throw .invalidState
            }
            try await service.savePrimaryArea(selected)
            state = .safetyBoundary(selected)
        case .acknowledgeSafety:
            guard case .safetyBoundary(let area) = state else { throw .invalidState }
            try await service.acknowledgeSafetyBoundary()
            state = .firstCheckIn(area)
        case .completeOnboarding:
            guard case .firstCheckIn = state else { throw .invalidState }
            state = .today(try await service.completeOnboarding())
        case .startCheckIn:
            guard case .today = state else { throw .invalidState }
            state = .checkInChange(try await service.beginSingleAreaCheckIn())
        case .selectComfort(let comfort):
            guard case .checkInComfort(let draft, let change) = state else {
                throw .invalidState
            }
            if change == .worse || comfort == .limited {
                state = .conditionalSafety(draft, change, comfort)
            } else {
                try await submit(draft: draft, change: change, comfort: comfort, answer: nil)
            }
        case .answerConditionalSafety(let answer):
            guard case .conditionalSafety(let draft, let change, let comfort) = state else {
                throw .invalidState
            }
            try await submit(draft: draft, change: change, comfort: comfort, answer: answer)
        case .chooseDuration(let duration):
            guard case .plan(let plan) = state else { throw .invalidState }
            state = .plan(try await service.revisePlan(
                checkInID: plan.checkInID,
                duration: duration,
                requestedLevel: plan.selectedLevel == plan.recommendedLevel ? nil : plan.selectedLevel
            ))
        case .chooseGentlerLevel(let level):
            guard case .plan(let plan) = state, level < plan.recommendedLevel else {
                throw .invalidState
            }
            state = .plan(try await service.revisePlan(
                checkInID: plan.checkInID,
                duration: plan.duration,
                requestedLevel: level
            ))
        case .startRoutine:
            guard case .plan(let plan) = state else { throw .invalidState }
            state = .routine(try await service.startRoutine(decisionID: plan.decisionID))
        case .advanceRoutine:
            guard case .routine(let routine) = state else { throw .invalidState }
            let updated = try await service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
            state = updated.status.isTerminal ? .feedback(updated) : .routine(updated)
        case .submitFeedback(let response):
            guard case .feedback(let routine) = state else { throw .invalidState }
            try await service.submitFeedback(sessionID: routine.sessionID, response: response)
            state = .completion(routine.area)
        case .retry:
            guard let failedAction, failedAction != .retry else { throw .invalidState }
            try await perform(failedAction)
        case .getStarted, .underAge, .correctAge, .selectPrimaryArea,
             .selectChange, .finishCompletion:
            throw .invalidState
        }
    }

    private func submit(
        draft: SingleAreaCheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        answer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) {
        let result = try await service.submitSingleAreaCheckIn(
            draft,
            change: change,
            comfort: comfort,
            safetyAnswer: answer
        )
        switch result {
        case .attentionRequired(let area): state = .attentionRequired(area)
        case .plan(let plan): state = .plan(plan)
        }
    }

    private func routeToProductStart() async throws(ProductFlowError) {
        switch try await service.loadProductStartState() {
        case .onboarding(.welcome): state = .welcome
        case .onboarding(.primaryArea): state = .primaryArea(nil)
        case .onboarding(.safetyBoundary(let area)): state = .safetyBoundary(area)
        case .onboarding(.firstCheckIn(let area)): state = .firstCheckIn(area)
        case .today(let area): state = .today(area)
        }
    }

    private func handle(_ error: ProductFlowError) {
        if case .attentionRequired(let areas) = error, let area = areas.first {
            state = .attentionRequired(area)
            return
        }
        errorMessage = switch error {
        case .persistence: "Kineo couldn't save that change. Try again."
        case .foundationNotReady: "Local storage isn't ready yet. Try again."
        case .contentUnavailable: "No approved prototype routine is available for this plan."
        case .attentionRequired: "A routine is unavailable while Attention Required is active."
        case .invalidState, .invalidData: "Kineo couldn't continue from this state. Try again."
        }
    }
}

private enum ProductFlowModelConstants {
    static let initialActionSequence = 0
    static let actionSequenceIncrement = 1
}
