/// Whether a configured secondary area participates in this session.
public enum SecondaryParticipation: String, Equatable, Sendable {
    case include
    case skipForSession
}

/// The selection-safe representation of one area's current answers.
public struct SelectionAreaCheckIn: Equatable, Sendable {
    public let checkInEntryID: CheckInEntryID
    public let entryRevision: Int
    public let area: BodyArea
    public let changeReport: ChangeReport
    public let movementComfort: MovementComfort
    public let conditionalSafetyAnswer: ConditionalSafetyAnswer?

    public init(
        checkInEntryID: CheckInEntryID,
        entryRevision: Int,
        area: BodyArea,
        changeReport: ChangeReport,
        movementComfort: MovementComfort,
        conditionalSafetyAnswer: ConditionalSafetyAnswer?
    ) {
        self.checkInEntryID = checkInEntryID
        self.entryRevision = entryRevision
        self.area = area
        self.changeReport = changeReport
        self.movementComfort = movementComfort
        self.conditionalSafetyAnswer = conditionalSafetyAnswer
    }

    public var requiresConditionalSafetyAnswer: Bool {
        changeReport == .worse || movementComfort == .limited
    }
}

/// Current persisted safety state for one area.
public struct SelectionSafetySnapshot: Equatable, Sendable {
    public let area: BodyArea
    public let status: SafetyStatus

    public init(area: BodyArea, status: SafetyStatus) {
        self.area = area
        self.status = status
    }
}

/// A frozen, deterministic input to plan selection.
public struct PlanSelectionRequest: Equatable, Sendable {
    public let decisionID: SelectionDecisionID
    public let checkInID: CheckInID
    public let decisionRevision: Int
    public let primaryArea: BodyArea
    public let secondaryArea: BodyArea?
    public let secondaryParticipation: SecondaryParticipation?
    public let checkInsByArea: [BodyArea: SelectionAreaCheckIn]
    public let safetyByArea: [BodyArea: SelectionSafetySnapshot]
    public let historyByArea: [BodyArea: ActiveHistoryState]
    public let requestedOverride: RoutineLevel?
    public let duration: DurationVariant
    public let rulesVersion: String
    public let catalogVersion: NonEmptyString

    public init(
        decisionID: SelectionDecisionID,
        checkInID: CheckInID,
        decisionRevision: Int,
        primaryArea: BodyArea,
        secondaryArea: BodyArea?,
        secondaryParticipation: SecondaryParticipation?,
        checkInsByArea: [BodyArea: SelectionAreaCheckIn],
        safetyByArea: [BodyArea: SelectionSafetySnapshot],
        historyByArea: [BodyArea: ActiveHistoryState],
        requestedOverride: RoutineLevel?,
        duration: DurationVariant,
        rulesVersion: String,
        catalogVersion: NonEmptyString
    ) {
        self.decisionID = decisionID
        self.checkInID = checkInID
        self.decisionRevision = decisionRevision
        self.primaryArea = primaryArea
        self.secondaryArea = secondaryArea
        self.secondaryParticipation = secondaryParticipation
        self.checkInsByArea = checkInsByArea
        self.safetyByArea = safetyByArea
        self.historyByArea = historyByArea
        self.requestedOverride = requestedOverride
        self.duration = duration
        self.rulesVersion = rulesVersion
        self.catalogVersion = catalogVersion
    }
}

/// Why selection did not produce a plan.
public enum NoPlanReason: String, Equatable, Sendable {
    case needsPrimaryCheckIn = "needs_primary_check_in"
    case needsPrimaryConditionalSafetyAnswer = "needs_primary_safety_answer"
    case needsSecondaryCheckIn = "needs_secondary_check_in"
    case needsSecondaryConditionalSafetyAnswer = "needs_secondary_safety_answer"
    case attentionRequired = "attention_required"
    case invalidInput = "invalid_input"
}

/// A safety transition discovered by defensive selection evaluation.
public struct SelectionSafetyTransition: Equatable, Sendable {
    public let area: BodyArea
    public let sourceCheckInEntryID: CheckInEntryID
    public let answer: ConditionalSafetyAnswer

    fileprivate init(
        area: BodyArea,
        sourceCheckInEntryID: CheckInEntryID,
        answer: ConditionalSafetyAnswer
    ) {
        self.area = area
        self.sourceCheckInEntryID = sourceCheckInEntryID
        self.answer = answer
    }
}

/// A body area's contribution to a selected plan.
public struct SelectedAreaDecision: Equatable, Sendable {
    public let area: BodyArea
    public let role: AreaRole
    public let checkInEntryID: CheckInEntryID
    public let entryRevision: Int
    public let baseLevel: RoutineLevel
    public let activeUnlocked: Bool

    fileprivate init(
        area: BodyArea,
        role: AreaRole,
        checkInEntryID: CheckInEntryID,
        entryRevision: Int,
        baseLevel: RoutineLevel,
        activeUnlocked: Bool
    ) {
        self.area = area
        self.role = role
        self.checkInEntryID = checkInEntryID
        self.entryRevision = entryRevision
        self.baseLevel = baseLevel
        self.activeUnlocked = activeUnlocked
    }
}

/// A deliberately omitted area and its typed reason.
public struct SelectedOmittedArea: Equatable, Sendable {
    public let area: BodyArea
    public let reason: OmissionReason

    fileprivate init(area: BodyArea, reason: OmissionReason) {
        self.area = area
        self.reason = reason
    }
}

/// Exact input passed from selection to catalog composition.
public struct RoutineCompositionRequest: Equatable, Sendable {
    public let primaryArea: BodyArea
    public let secondaryArea: BodyArea?
    public let selectedLevel: RoutineLevel
    public let duration: DurationVariant
    public let rulesVersion: String
    public let catalogVersion: NonEmptyString

    fileprivate init(
        primaryArea: BodyArea,
        secondaryArea: BodyArea?,
        selectedLevel: RoutineLevel,
        duration: DurationVariant,
        rulesVersion: String,
        catalogVersion: NonEmptyString
    ) {
        self.primaryArea = primaryArea
        self.secondaryArea = secondaryArea
        self.selectedLevel = selectedLevel
        self.duration = duration
        self.rulesVersion = rulesVersion
        self.catalogVersion = catalogVersion
    }
}

/// Stable explanation keys emitted by the selector.
public enum SelectionExplanationKey: String, Equatable, Sendable {
    case userGentlerOverride = "reason.user_gentler_override"
    case reportedWorse = "reason.reported_worse"
    case movementLimited = "reason.movement_limited"
    case betterGoodActive = "reason.better_good_active"
    case balancedCheckIn = "reason.balanced_checkin"
    case activeLocked = "reason.active_locked"
    case secondaryMoreConservative = "reason.secondary_more_conservative"
}

/// A localizable selection explanation.
public struct SelectionExplanation: Equatable, Sendable {
    public let key: SelectionExplanationKey
    public let parameters: [String: String]

    fileprivate init(key: SelectionExplanationKey, parameters: [String: String]) {
        self.key = key
        self.parameters = parameters
    }
}

/// Stable notice keys emitted before composition.
public enum SelectionNoticeKey: String, Equatable, Sendable {
    case secondarySkipped = "notice.secondary_skipped"
}

/// A non-explanation disclosure about plan selection.
public struct SelectionPlanNotice: Equatable, Sendable {
    public let key: SelectionNoticeKey
    public let area: BodyArea?

    fileprivate init(key: SelectionNoticeKey, area: BodyArea?) {
        self.key = key
        self.area = area
    }
}

/// A plan selected independently of catalog availability.
public struct SelectedPlan: Equatable, Sendable {
    public let recommendedLevel: RoutineLevel
    public let requestedOverride: RoutineLevel?
    public let overrideDisposition: OverrideDisposition
    public let selectedLevel: RoutineLevel
    public let duration: DurationVariant
    public let includedAreaDecisions: [SelectedAreaDecision]
    public let omittedAreas: [SelectedOmittedArea]
    public let compositionRequest: RoutineCompositionRequest
    public let explanations: [SelectionExplanation]
    public let notices: [SelectionPlanNotice]
    public let pauseTodayAvailable: Bool

    fileprivate init(
        recommendedLevel: RoutineLevel,
        requestedOverride: RoutineLevel?,
        overrideDisposition: OverrideDisposition,
        selectedLevel: RoutineLevel,
        duration: DurationVariant,
        includedAreaDecisions: [SelectedAreaDecision],
        omittedAreas: [SelectedOmittedArea],
        compositionRequest: RoutineCompositionRequest,
        explanations: [SelectionExplanation],
        notices: [SelectionPlanNotice],
        pauseTodayAvailable: Bool
    ) {
        self.recommendedLevel = recommendedLevel
        self.requestedOverride = requestedOverride
        self.overrideDisposition = overrideDisposition
        self.selectedLevel = selectedLevel
        self.duration = duration
        self.includedAreaDecisions = includedAreaDecisions
        self.omittedAreas = omittedAreas
        self.compositionRequest = compositionRequest
        self.explanations = explanations
        self.notices = notices
        self.pauseTodayAvailable = pauseTodayAvailable
    }
}

/// The pure result of plan selection.
public enum PlanSelectionResult: Equatable, Sendable {
    case noPlan(
        reason: NoPlanReason,
        affectedAreas: [BodyArea],
        safetyTransitions: [SelectionSafetyTransition]
    )
    case selected(SelectedPlan)
}

/// Selects a bounded plan using only the frozen request and configured rules.
public struct PlanSelectionEngine: Sendable {
    /// The selector for the current immutable prototype rules version.
    public static let prototype = PlanSelectionEngine(activeUnlockConfiguration: .prototype)

    private static let firstDecisionRevision = 1
    private static let firstEntryRevision = 1
    private static let maximumExplanationCount = 2
    private static let areaParameter = "area"
    private static let levelParameter = "level"
    private static let thresholdParameter = "threshold"

    public let activeUnlockConfiguration: ActiveUnlockConfiguration

    private init(activeUnlockConfiguration: ActiveUnlockConfiguration) {
        self.activeUnlockConfiguration = activeUnlockConfiguration
    }

    /// Selects a plan or a typed continuation state. Invalid input fails closed.
    public func select(_ request: PlanSelectionRequest) -> PlanSelectionResult {
        guard isStructurallyValid(request) else {
            return noPlan(.invalidInput)
        }

        let configuredAreas = [request.primaryArea] + optionalArray(request.secondaryArea)
        let existingAttention = PrototypeSelectionRules.supportedAreas.filter {
            request.safetyByArea[$0]?.status == .attentionRequired
        }
        let safetyTransitions = configuredAreas.compactMap { area -> SelectionSafetyTransition? in
            guard let checkIn = request.checkInsByArea[area],
                  checkIn.requiresConditionalSafetyAnswer,
                  let answer = checkIn.conditionalSafetyAnswer,
                  answer == .yes || answer == .notSure else {
                return nil
            }
            return SelectionSafetyTransition(
                area: area,
                sourceCheckInEntryID: checkIn.checkInEntryID,
                answer: answer
            )
        }
        let newlyFlagged = safetyTransitions.map(\.area)
        if !existingAttention.isEmpty || !newlyFlagged.isEmpty {
            return .noPlan(
                reason: .attentionRequired,
                affectedAreas: orderedAffectedAreas(
                    configuredAreas: configuredAreas,
                    affectedAreas: existingAttention + newlyFlagged
                ),
                safetyTransitions: safetyTransitions
            )
        }

        if let primary = request.checkInsByArea[request.primaryArea],
           primary.requiresConditionalSafetyAnswer,
           primary.conditionalSafetyAnswer == nil {
            return noPlan(.needsPrimaryConditionalSafetyAnswer, area: request.primaryArea)
        }
        if let secondaryArea = request.secondaryArea,
           let secondary = request.checkInsByArea[secondaryArea],
           secondary.requiresConditionalSafetyAnswer,
           secondary.conditionalSafetyAnswer == nil {
            return noPlan(.needsSecondaryConditionalSafetyAnswer, area: secondaryArea)
        }
        guard let primaryCheckIn = request.checkInsByArea[request.primaryArea] else {
            return noPlan(.needsPrimaryCheckIn, area: request.primaryArea)
        }

        var includedCheckIns = [(role: AreaRole.primary, checkIn: primaryCheckIn)]
        var omittedAreas: [SelectedOmittedArea] = []
        var notices: [SelectionPlanNotice] = []
        if let secondaryArea = request.secondaryArea {
            switch request.secondaryParticipation {
            case .include:
                guard let secondaryCheckIn = request.checkInsByArea[secondaryArea] else {
                    return noPlan(.needsSecondaryCheckIn, area: secondaryArea)
                }
                includedCheckIns.append((role: .secondary, checkIn: secondaryCheckIn))
            case .skipForSession:
                omittedAreas.append(
                    SelectedOmittedArea(area: secondaryArea, reason: .secondaryUnanswered)
                )
                notices.append(SelectionPlanNotice(key: .secondarySkipped, area: secondaryArea))
            case nil:
                return noPlan(.invalidInput)
            }
        }

        let areaDecisions = includedCheckIns.map { item in
            areaDecision(for: item.checkIn, role: item.role, request: request)
        }
        guard let recommendedLevel = areaDecisions.map(\.baseLevel).min() else {
            return noPlan(.invalidInput)
        }
        let override = applyOverride(request.requestedOverride, to: recommendedLevel)
        let explanations = buildExplanations(
            request: request,
            areaDecisions: areaDecisions,
            recommendedLevel: recommendedLevel,
            selectedLevel: override.level,
            overrideDisposition: override.disposition
        )
        let includedSecondary = areaDecisions.first(where: { $0.role == .secondary })?.area
        let composition = RoutineCompositionRequest(
            primaryArea: request.primaryArea,
            secondaryArea: includedSecondary,
            selectedLevel: override.level,
            duration: request.duration,
            rulesVersion: request.rulesVersion,
            catalogVersion: request.catalogVersion
        )
        let pauseTodayAvailable = request.checkInsByArea.values.contains {
            $0.requiresConditionalSafetyAnswer && $0.conditionalSafetyAnswer == .no
        }

        return .selected(
            SelectedPlan(
                recommendedLevel: recommendedLevel,
                requestedOverride: request.requestedOverride,
                overrideDisposition: override.disposition,
                selectedLevel: override.level,
                duration: request.duration,
                includedAreaDecisions: areaDecisions,
                omittedAreas: omittedAreas,
                compositionRequest: composition,
                explanations: explanations,
                notices: notices,
                pauseTodayAvailable: pauseTodayAvailable
            )
        )
    }

    private func isStructurallyValid(_ request: PlanSelectionRequest) -> Bool {
        guard request.rulesVersion == PrototypeSelectionRules.version,
              request.decisionRevision >= Self.firstDecisionRevision,
              request.primaryArea != request.secondaryArea,
              (request.secondaryArea == nil) == (request.secondaryParticipation == nil),
              request.safetyByArea.count == PrototypeSelectionRules.supportedAreas.count else {
            return false
        }

        let configuredAreas = Set([request.primaryArea] + optionalArray(request.secondaryArea))
        let checkInsAreValid = request.checkInsByArea.allSatisfy { area, checkIn in
            area == checkIn.area &&
                configuredAreas.contains(area) &&
                checkIn.entryRevision >= Self.firstEntryRevision &&
                (checkIn.requiresConditionalSafetyAnswer || checkIn.conditionalSafetyAnswer == nil)
        }
        guard checkInsAreValid,
              Set(request.checkInsByArea.values.map(\.checkInEntryID)).count == request.checkInsByArea.count else {
            return false
        }

        let safetyIsValid = PrototypeSelectionRules.supportedAreas.allSatisfy { area in
            request.safetyByArea[area]?.area == area
        }
        let historyIsValid = request.historyByArea.allSatisfy { area, history in
            area == history.area
        }
        return safetyIsValid && historyIsValid
    }

    private func areaDecision(
        for checkIn: SelectionAreaCheckIn,
        role: AreaRole,
        request: PlanSelectionRequest
    ) -> SelectedAreaDecision {
        let activeUnlocked = request.historyByArea[checkIn.area]
            .map { $0.isActiveUnlocked(using: activeUnlockConfiguration) } ?? false
        let level = AreaLevelRule.level(
            changeReport: checkIn.changeReport,
            movementComfort: checkIn.movementComfort,
            activeUnlocked: activeUnlocked
        )
        return SelectedAreaDecision(
            area: checkIn.area,
            role: role,
            checkInEntryID: checkIn.checkInEntryID,
            entryRevision: checkIn.entryRevision,
            baseLevel: level,
            activeUnlocked: activeUnlocked
        )
    }

    private func applyOverride(
        _ requested: RoutineLevel?,
        to recommended: RoutineLevel
    ) -> (level: RoutineLevel, disposition: OverrideDisposition) {
        guard let requested else { return (recommended, .none) }
        if requested < recommended {
            return (requested, .acceptedGentler)
        }
        if requested == recommended {
            return (recommended, .sameAsRecommended)
        }
        return (recommended, .rejectedHigher)
    }

    private func buildExplanations(
        request: PlanSelectionRequest,
        areaDecisions: [SelectedAreaDecision],
        recommendedLevel: RoutineLevel,
        selectedLevel: RoutineLevel,
        overrideDisposition: OverrideDisposition
    ) -> [SelectionExplanation] {
        var result: [SelectionExplanation] = []
        if overrideDisposition == .acceptedGentler {
            appendExplanation(
                SelectionExplanation(
                    key: .userGentlerOverride,
                    parameters: [Self.levelParameter: selectedLevel.rawValue]
                ),
                to: &result
            )
        }

        guard let anchor = explanationAnchor(in: areaDecisions),
              let checkIn = request.checkInsByArea[anchor.area] else {
            return result
        }
        appendExplanation(
            checkInExplanation(
                checkIn: checkIn,
                decision: anchor,
                configuration: activeUnlockConfiguration
            ),
            to: &result
        )

        if let secondary = areaDecisions.first(where: { $0.role == .secondary }),
           let primary = areaDecisions.first(where: { $0.role == .primary }),
           secondary.baseLevel < primary.baseLevel,
           recommendedLevel == secondary.baseLevel {
            appendExplanation(
                SelectionExplanation(
                    key: .secondaryMoreConservative,
                    parameters: [Self.areaParameter: secondary.area.rawValue]
                ),
                to: &result
            )
        }
        return result
    }

    private func explanationAnchor(in decisions: [SelectedAreaDecision]) -> SelectedAreaDecision? {
        guard let minimumLevel = decisions.map(\.baseLevel).min() else { return nil }
        return decisions.first(where: { $0.baseLevel == minimumLevel })
    }

    private func checkInExplanation(
        checkIn: SelectionAreaCheckIn,
        decision: SelectedAreaDecision,
        configuration: ActiveUnlockConfiguration
    ) -> SelectionExplanation {
        let areaParameters = [Self.areaParameter: checkIn.area.rawValue]
        if checkIn.changeReport == .worse {
            return SelectionExplanation(key: .reportedWorse, parameters: areaParameters)
        }
        if checkIn.movementComfort == .limited {
            return SelectionExplanation(key: .movementLimited, parameters: areaParameters)
        }
        if decision.baseLevel == .active {
            return SelectionExplanation(key: .betterGoodActive, parameters: areaParameters)
        }
        if checkIn.changeReport == .better,
           checkIn.movementComfort == .good,
           !decision.activeUnlocked {
            return SelectionExplanation(
                key: .activeLocked,
                parameters: [
                    Self.areaParameter: checkIn.area.rawValue,
                    Self.thresholdParameter: String(configuration.qualifyingOutcomeCountRequired)
                ]
            )
        }
        return SelectionExplanation(key: .balancedCheckIn, parameters: areaParameters)
    }

    private func appendExplanation(
        _ explanation: SelectionExplanation,
        to explanations: inout [SelectionExplanation]
    ) {
        guard explanations.count < Self.maximumExplanationCount else { return }
        explanations.append(explanation)
    }

    private func orderedAffectedAreas(
        configuredAreas: [BodyArea],
        affectedAreas: [BodyArea]
    ) -> [BodyArea] {
        let affected = Set(affectedAreas)
        let preferredOrder = configuredAreas + PrototypeSelectionRules.supportedAreas
        return preferredOrder.reduce(into: []) { ordered, area in
            if affected.contains(area), !ordered.contains(area) {
                ordered.append(area)
            }
        }
    }

    private func optionalArray<T>(_ value: T?) -> [T] {
        value.map { [$0] } ?? []
    }

    private func noPlan(_ reason: NoPlanReason, area: BodyArea? = nil) -> PlanSelectionResult {
        .noPlan(
            reason: reason,
            affectedAreas: optionalArray(area),
            safetyTransitions: []
        )
    }
}
