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
    case attentionGuidance(AttentionPrompt)
    case attentionReturn(AttentionPrompt)
    case attentionCorrectionChange(AttentionPrompt, AttentionCorrectionDraft)
    case attentionCorrectionComfort(AttentionPrompt, AttentionCorrectionDraft, ChangeReport)
    case attentionCorrectionSafety(
        AttentionPrompt,
        AttentionCorrectionDraft,
        ChangeReport,
        MovementComfort
    )
    case plan(PlanPresentation)
    case pauseTodayConfirmation(BodyArea)
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
    case showAttentionReturn
    case answerAttentionReturn(ConditionalSafetyAnswer)
    case startAttentionCorrection
    case selectCorrectionChange(ChangeReport)
    case selectCorrectionComfort(MovementComfort)
    case answerCorrectionSafety(ConditionalSafetyAnswer)
    case cancelAttentionCorrection
    case chooseDuration(DurationVariant)
    case chooseGentlerLevel(RoutineLevel)
    case pauseToday
    case finishPauseToday
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
        } catch let error {
            if case .attentionRequired = error {
                do {
                    try await routeToProductStart()
                    failedAction = nil
                } catch let routingError {
                    failedAction = action
                    handle(routingError)
                }
            } else {
                failedAction = action
                handle(error)
            }
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
        case .showAttentionReturn:
            guard case .attentionGuidance(let prompt) = state else { return true }
            state = .attentionReturn(prompt)
        case .selectCorrectionChange(let change):
            guard case .attentionCorrectionChange(let prompt, let draft) = state else { return true }
            state = .attentionCorrectionComfort(prompt, draft, change)
        case .cancelAttentionCorrection:
            switch state {
            case .attentionCorrectionChange(let prompt, _),
                 .attentionCorrectionComfort(let prompt, _, _),
                 .attentionCorrectionSafety(let prompt, _, _, _):
                state = .attentionReturn(prompt)
            default:
                return true
            }
        case .finishPauseToday:
            guard case .pauseTodayConfirmation(let area) = state else { return true }
            state = .today(area)
        case .finishCompletion:
            guard case .completion(let area) = state else { return true }
            state = .today(area)
        case .load, .confirmAdult, .continuePrimaryArea, .acknowledgeSafety,
             .completeOnboarding, .startCheckIn, .selectComfort,
             .answerConditionalSafety, .answerAttentionReturn, .startAttentionCorrection,
             .selectCorrectionComfort, .answerCorrectionSafety,
             .chooseDuration, .chooseGentlerLevel, .pauseToday,
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
        case .answerAttentionReturn(let answer):
            guard case .attentionReturn(let prompt) = state else { throw .invalidState }
            route(try await service.respondToAttentionReturn(prompt, answer: answer))
        case .startAttentionCorrection:
            let prompt: AttentionPrompt
            switch state {
            case .attentionGuidance(let value), .attentionReturn(let value):
                prompt = value
            default:
                throw .invalidState
            }
            state = .attentionCorrectionChange(
                prompt,
                try await service.beginAttentionCorrection(prompt)
            )
        case .selectCorrectionComfort(let comfort):
            guard case .attentionCorrectionComfort(let prompt, let draft, let change) = state else {
                throw .invalidState
            }
            if change == .worse || comfort == .limited {
                state = .attentionCorrectionSafety(prompt, draft, change, comfort)
            } else {
                try await submitCorrection(
                    prompt: prompt,
                    draft: draft,
                    change: change,
                    comfort: comfort,
                    answer: nil
                )
            }
        case .answerCorrectionSafety(let answer):
            guard case .attentionCorrectionSafety(
                let prompt,
                let draft,
                let change,
                let comfort
            ) = state else {
                throw .invalidState
            }
            try await submitCorrection(
                prompt: prompt,
                draft: draft,
                change: change,
                comfort: comfort,
                answer: answer
            )
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
        case .pauseToday:
            guard case .plan(let plan) = state, plan.pauseTodayAvailable else {
                throw .invalidState
            }
            state = .pauseTodayConfirmation(
                try await service.pauseToday(checkInID: plan.checkInID)
            )
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
             .selectChange, .showAttentionReturn, .selectCorrectionChange,
             .cancelAttentionCorrection, .finishPauseToday, .finishCompletion:
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
        case .attentionRequired(let prompt): state = .attentionGuidance(prompt)
        case .plan(let plan): state = .plan(plan)
        }
    }

    private func submitCorrection(
        prompt: AttentionPrompt,
        draft: AttentionCorrectionDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        answer: ConditionalSafetyAnswer?
    ) async throws(ProductFlowError) {
        route(try await service.submitAttentionCorrection(
            draft,
            change: change,
            comfort: comfort,
            safetyAnswer: answer
        ))
    }

    private func route(_ resolution: AttentionResolution) {
        switch resolution {
        case .attentionRequired(let prompt):
            state = .attentionGuidance(prompt)
        case .ready(let area):
            state = .today(area)
        }
    }

    private func routeToProductStart() async throws(ProductFlowError) {
        switch try await service.loadProductStartState() {
        case .onboarding(.welcome): state = .welcome
        case .onboarding(.primaryArea): state = .primaryArea(nil)
        case .onboarding(.safetyBoundary(let area)): state = .safetyBoundary(area)
        case .onboarding(.firstCheckIn(let area)): state = .firstCheckIn(area)
        case .attentionRequired(let prompt): state = .attentionReturn(prompt)
        case .today(let area): state = .today(area)
        }
    }

    private func handle(_ error: ProductFlowError) {
        errorMessage = switch error {
        case .persistence: "Kineo couldn't save that change. Try again."
        case .foundationNotReady: "Local storage isn't ready yet. Try again."
        case .contentUnavailable: "No approved prototype routine is available for this plan."
        case .attentionRequired: "Attention Required is active. Reload Today to continue safely."
        case .invalidState, .invalidData: "Kineo couldn't continue from this state. Try again."
        }
    }
}

private enum ProductFlowModelConstants {
    static let initialActionSequence = 0
    static let actionSequenceIncrement = 1
}
