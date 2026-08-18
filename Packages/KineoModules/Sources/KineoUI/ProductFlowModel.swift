import KineoCore
import Observation

enum ProductScreenState: Equatable {
    case launching(AppLaunchState)
    case welcome
    case ageConfirmation
    case ageUnavailable
    case primaryArea(BodyArea?)
    case secondaryArea(primary: BodyArea, selected: BodyArea?)
    case safetyBoundary(BodyArea)
    case firstCheckIn(BodyArea)
    case today(BodyArea)
    case checkInChange(CheckInDraft)
    case checkInComfort(CheckInDraft, ChangeReport)
    case conditionalSafety(CheckInDraft, ChangeReport, MovementComfort)
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
    case alternativePreview(RoutinePresentation)
    case endConfirmation(RoutinePresentation)
    case safetyGuidance(RoutinePresentation)
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
    case selectSecondaryArea(BodyArea?)
    case continueSecondaryArea
    case acknowledgeSafety
    case completeOnboarding
    case startCheckIn
    case selectChange(ChangeReport)
    case selectComfort(MovementComfort)
    case answerConditionalSafety(ConditionalSafetyAnswer)
    case skipSecondaryArea
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
    case refreshRoutine
    case pauseRoutine
    case resumeRoutine
    case skipRoutineStep(RoutineEventReason?)
    case requestAlternative
    case chooseAlternative(CatalogID)
    case cancelRoutineModal
    case requestEndRoutine
    case confirmEndRoutine
    case somethingFeelsWrong
    case confirmSafetyEnd
    case safetyTappedByMistake
    case backgroundRoutine
    case advanceRoutine
    case submitFeedback(AreaResponse?)
    case selectFeedback(BodyArea, AreaResponse)
    case submitAreaFeedback
    case skipFeedback
    case finishCompletion
    case retry
}

@Observable @MainActor
final class ProductFlowModel {
    private let service: any KineoProductServing
    private var pendingAction: ProductFlowAction?
    private var failedAction: ProductFlowAction?
    private var pendingPrimaryAnswers: AreaCheckInAnswers?
    private var pendingSecondaryAnswers: AreaCheckInAnswers?
    private var safetyQuestionArea: BodyArea?
    private var feedbackResponses = [BodyArea: AreaResponse]()

    private(set) var state: ProductScreenState = .launching(.preparingFoundation)
    private(set) var actionSequence = ProductFlowModelConstants.initialActionSequence
    private(set) var isSubmitting = false
    private(set) var errorMessage: String?

    var activeRoutineSessionID: RoutineSessionID? {
        guard case .routine(let routine) = state, routine.status == .inProgress else { return nil }
        return routine.sessionID
    }

    var currentCheckInArea: BodyArea? {
        switch state {
        case .checkInChange(let draft), .checkInComfort(let draft, _):
            pendingPrimaryAnswers == nil ? draft.area : draft.secondaryArea
        case .conditionalSafety:
            safetyQuestionArea
        default:
            nil
        }
    }

    var canSkipSecondaryArea: Bool {
        guard pendingPrimaryAnswers != nil else { return false }
        return switch state {
        case .checkInChange:
            true
        case .checkInComfort(_, let change):
            change != .worse
        default:
            false
        }
    }

    func feedbackResponse(for area: BodyArea) -> AreaResponse? {
        feedbackResponses[area]
    }

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
        case .selectSecondaryArea(let area):
            guard case .secondaryArea(let primary, _) = state,
                  area != primary else { return true }
            state = .secondaryArea(primary: primary, selected: area)
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
        case .cancelRoutineModal:
            switch state {
            case .alternativePreview(let routine), .endConfirmation(let routine):
                state = .routine(routine)
            default:
                return true
            }
        case .safetyTappedByMistake:
            guard case .safetyGuidance(let routine) = state else { return true }
            state = .routine(routine)
        case .finishCompletion:
            guard case .completion(let area) = state else { return true }
            state = .today(area)
        case .selectFeedback(let area, let response):
            guard case .feedback(let routine) = state,
                  routine.includedAreas.contains(area) else { return true }
            feedbackResponses[area] = response
        case .load, .confirmAdult, .continuePrimaryArea, .continueSecondaryArea, .acknowledgeSafety,
             .completeOnboarding, .startCheckIn, .selectComfort,
             .answerConditionalSafety, .skipSecondaryArea,
             .answerAttentionReturn, .startAttentionCorrection,
             .selectCorrectionComfort, .answerCorrectionSafety,
             .chooseDuration, .chooseGentlerLevel, .pauseToday,
             .startRoutine, .refreshRoutine, .pauseRoutine, .resumeRoutine,
             .skipRoutineStep, .requestAlternative, .chooseAlternative,
             .requestEndRoutine, .confirmEndRoutine, .somethingFeelsWrong,
             .confirmSafetyEnd, .backgroundRoutine,
             .advanceRoutine, .submitFeedback, .submitAreaFeedback, .skipFeedback, .retry:
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
            state = .secondaryArea(primary: selected, selected: nil)
        case .continueSecondaryArea:
            guard case .secondaryArea(let primary, let secondary) = state else {
                throw .invalidState
            }
            try await service.saveSecondaryArea(secondary)
            state = .safetyBoundary(primary)
        case .acknowledgeSafety:
            guard case .safetyBoundary(let area) = state else { throw .invalidState }
            try await service.acknowledgeSafetyBoundary()
            state = .firstCheckIn(area)
        case .completeOnboarding:
            guard case .firstCheckIn = state else { throw .invalidState }
            state = .today(try await service.completeOnboarding())
        case .startCheckIn:
            guard case .today = state else { throw .invalidState }
            pendingPrimaryAnswers = nil
            pendingSecondaryAnswers = nil
            safetyQuestionArea = nil
            state = .checkInChange(try await service.beginCheckIn())
        case .selectComfort(let comfort):
            guard case .checkInComfort(let draft, let change) = state else {
                throw .invalidState
            }
            try await collectBasicAnswers(draft: draft, change: change, comfort: comfort)
        case .answerConditionalSafety(let answer):
            guard case .conditionalSafety(let draft, let change, let comfort) = state else {
                throw .invalidState
            }
            try await answerSafetyQuestion(
                draft: draft,
                change: change,
                comfort: comfort,
                answer: answer
            )
        case .skipSecondaryArea:
            guard let primary = pendingPrimaryAnswers else { throw .invalidState }
            switch state {
            case .checkInChange(let draft):
                try await omitSecondary(draft: draft, primary: primary)
            case .checkInComfort(let draft, let change) where change != .worse:
                try await omitSecondary(draft: draft, primary: primary)
            default:
                throw .invalidState
            }
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
        case .refreshRoutine:
            guard case .routine(let routine) = state, routine.status == .inProgress else {
                throw .invalidState
            }
            state = .routine(try await service.refreshRoutine(sessionID: routine.sessionID))
        case .pauseRoutine, .backgroundRoutine:
            guard case .routine(let routine) = state else { throw .invalidState }
            state = .routine(try await service.pauseRoutine(sessionID: routine.sessionID))
        case .resumeRoutine:
            guard case .routine(let routine) = state, routine.status == .paused else {
                throw .invalidState
            }
            state = .routine(try await service.resumeRoutine(sessionID: routine.sessionID))
        case .skipRoutineStep(let reason):
            guard case .routine(let routine) = state else { throw .invalidState }
            let updated = try await service.skipRoutineStep(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex,
                reason: reason
            )
            if updated.status.isTerminal { feedbackResponses.removeAll() }
            state = updated.status.isTerminal ? .feedback(updated) : .routine(updated)
        case .requestAlternative:
            guard case .routine(let routine) = state,
                  routine.currentItem?.availableAlternatives.isEmpty == false else {
                throw .invalidState
            }
            state = .alternativePreview(
                try await service.pauseRoutine(sessionID: routine.sessionID)
            )
        case .chooseAlternative(let movementID):
            guard case .alternativePreview(let routine) = state else { throw .invalidState }
            state = .routine(try await service.selectRoutineAlternative(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex,
                movementID: movementID
            ))
        case .requestEndRoutine:
            guard case .routine(let routine) = state else { throw .invalidState }
            state = .endConfirmation(
                try await service.pauseRoutine(sessionID: routine.sessionID)
            )
        case .confirmEndRoutine:
            guard case .endConfirmation(let routine) = state else { throw .invalidState }
            feedbackResponses.removeAll()
            state = .feedback(try await service.endRoutine(
                sessionID: routine.sessionID,
                forSafety: false
            ))
        case .somethingFeelsWrong:
            guard case .routine(let routine) = state else { throw .invalidState }
            state = .safetyGuidance(
                try await service.pauseRoutine(sessionID: routine.sessionID)
            )
        case .confirmSafetyEnd:
            guard case .safetyGuidance(let routine) = state else { throw .invalidState }
            feedbackResponses.removeAll()
            state = .feedback(try await service.endRoutine(
                sessionID: routine.sessionID,
                forSafety: true
            ))
        case .advanceRoutine:
            guard case .routine(let routine) = state else { throw .invalidState }
            let updated = try await service.advanceRoutine(
                sessionID: routine.sessionID,
                expectedStepIndex: routine.currentStepIndex
            )
            if updated.status.isTerminal { feedbackResponses.removeAll() }
            state = updated.status.isTerminal ? .feedback(updated) : .routine(updated)
        case .submitFeedback(let response):
            guard case .feedback(let routine) = state else { throw .invalidState }
            try await service.submitFeedback(sessionID: routine.sessionID, response: response)
            state = .completion(routine.area)
        case .submitAreaFeedback:
            guard case .feedback(let routine) = state else { throw .invalidState }
            try await service.submitFeedback(
                sessionID: routine.sessionID,
                responses: feedbackResponses
            )
            state = .completion(routine.area)
        case .skipFeedback:
            guard case .feedback(let routine) = state else { throw .invalidState }
            try await service.submitFeedback(sessionID: routine.sessionID, responses: [:])
            state = .completion(routine.area)
        case .retry:
            guard let failedAction, failedAction != .retry else { throw .invalidState }
            try await perform(failedAction)
        case .getStarted, .underAge, .correctAge, .selectPrimaryArea, .selectSecondaryArea,
             .selectChange, .selectFeedback, .showAttentionReturn, .selectCorrectionChange,
             .cancelAttentionCorrection, .finishPauseToday, .cancelRoutineModal,
             .safetyTappedByMistake, .finishCompletion:
            throw .invalidState
        }
    }

    private func collectBasicAnswers(
        draft: CheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort
    ) async throws(ProductFlowError) {
        guard let area = currentCheckInArea else { throw .invalidState }
        let completed = AreaCheckInAnswers(
            area: area,
            change: change,
            comfort: comfort,
            safetyAnswer: nil
        )
        if pendingPrimaryAnswers == nil {
            pendingPrimaryAnswers = completed
            if draft.secondaryArea != nil {
                state = .checkInChange(draft)
                return
            }
        } else {
            pendingSecondaryAnswers = completed
        }
        try await routeNextSafetyQuestionOrSubmit(draft: draft)
    }

    private func answerSafetyQuestion(
        draft: CheckInDraft,
        change: ChangeReport,
        comfort: MovementComfort,
        answer: ConditionalSafetyAnswer
    ) async throws(ProductFlowError) {
        guard let area = safetyQuestionArea else { throw .invalidState }
        let answered = AreaCheckInAnswers(
            area: area,
            change: change,
            comfort: comfort,
            safetyAnswer: answer
        )
        if area == draft.area {
            pendingPrimaryAnswers = answered
        } else if area == draft.secondaryArea {
            pendingSecondaryAnswers = answered
        } else {
            throw .invalidState
        }
        safetyQuestionArea = nil
        try await routeNextSafetyQuestionOrSubmit(draft: draft)
    }

    private func omitSecondary(
        draft: CheckInDraft,
        primary: AreaCheckInAnswers
    ) async throws(ProductFlowError) {
        pendingSecondaryAnswers = nil
        if primary.requiresSafetyAnswer,
           primary.safetyAnswer == nil {
            safetyQuestionArea = primary.area
            state = .conditionalSafety(draft, primary.change, primary.comfort)
            return
        }
        try await submit(draft: draft, primary: primary, secondary: nil)
    }

    private func routeNextSafetyQuestionOrSubmit(
        draft: CheckInDraft
    ) async throws(ProductFlowError) {
        guard let primary = pendingPrimaryAnswers else { throw .invalidState }
        if primary.requiresSafetyAnswer,
           primary.safetyAnswer == nil {
            safetyQuestionArea = primary.area
            state = .conditionalSafety(draft, primary.change, primary.comfort)
            return
        }
        if let secondary = pendingSecondaryAnswers,
           secondary.requiresSafetyAnswer,
           secondary.safetyAnswer == nil {
            safetyQuestionArea = secondary.area
            state = .conditionalSafety(draft, secondary.change, secondary.comfort)
            return
        }
        try await submit(draft: draft, primary: primary, secondary: pendingSecondaryAnswers)
    }

    private func submit(
        draft: CheckInDraft,
        primary: AreaCheckInAnswers,
        secondary: AreaCheckInAnswers?
    ) async throws(ProductFlowError) {
        let result = try await service.submitCheckIn(
            draft,
            primary: primary,
            secondary: secondary
        )
        pendingPrimaryAnswers = nil
        pendingSecondaryAnswers = nil
        safetyQuestionArea = nil
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
        case .onboarding(.secondaryArea(let primary, let selected)):
            state = .secondaryArea(primary: primary, selected: selected)
        case .onboarding(.safetyBoundary(let area)): state = .safetyBoundary(area)
        case .onboarding(.firstCheckIn(let area)): state = .firstCheckIn(area)
        case .attentionRequired(let prompt): state = .attentionReturn(prompt)
        case .unfinishedCheckIn(let draft): state = .checkInChange(draft)
        case .unfinishedPlan(let plan): state = .plan(plan)
        case .unfinishedRoutine(let routine): state = .routine(routine)
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

    func refreshActiveRoutineUntilCancelled() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(ProductFlowModelConstants.refreshIntervalSeconds))
            } catch is CancellationError {
                return
            } catch {
                errorMessage = "Kineo couldn't update the routine timer."
                return
            }
            guard !isSubmitting,
                  case .routine(let routine) = state,
                  routine.status == .inProgress else { continue }
            do {
                let updated = try await service.refreshRoutine(sessionID: routine.sessionID)
                guard case .routine(let current) = state,
                      current.sessionID == updated.sessionID,
                      current.status == .inProgress else { continue }
                state = .routine(updated)
            } catch let error {
                handle(error)
                return
            }
        }
    }

    func pauseActiveRoutineForLifecycle() async {
        guard case .routine(let routine) = state, routine.status == .inProgress else { return }
        do {
            let updated = try await service.pauseRoutine(sessionID: routine.sessionID)
            guard case .routine(let current) = state,
                  current.sessionID == updated.sessionID,
                  !updated.status.isTerminal else { return }
            state = .routine(updated)
        } catch let error {
            handle(error)
        }
    }
}

private enum ProductFlowModelConstants {
    static let initialActionSequence = 0
    static let actionSequenceIncrement = 1
    static let refreshIntervalSeconds = 1
}
