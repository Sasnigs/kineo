import KineoCore
import Testing

@Suite("Plan selection engine")
struct PlanSelectionEngineTests {
    private enum FixtureError: Error {
        case expectedSelection
        case expectedNoPlan
    }

    private enum InvalidInputCase: CaseIterable, Sendable {
        case unsupportedRules
        case invalidDecisionRevision
        case missingSecondaryParticipation
        case unexpectedSecondaryParticipation
        case duplicateArea
        case straySafetyAnswer
        case missingSafetyArea
        case mismatchedSafetyArea
        case mismatchedCheckInArea
        case mismatchedHistoryArea
        case duplicateEntryID
    }

    private struct LevelInput {
        let change: ChangeReport
        let comfort: MovementComfort
        let safetyAnswer: ConditionalSafetyAnswer?
        let unlocked: Bool
    }

    private struct ExcludedSelectionContext {
        let healthValue: Int?
        let telemetryEnabled: Bool
        let reminderEnabled: Bool
        let connected: Bool
        let availableMinutes: Int
        let occupation: String
        let consistencyDays: Int
    }

    private static let catalogVersion = "catalog-v1"
    private static let validRevision = 1

    @Test("All single-area mappings are stable across area, unlock state, and duration")
    private func exhaustiveSingleAreaMapping() throws {
        for area in PrototypeSelectionRules.supportedAreas {
            for change in [ChangeReport.better, .similar, .worse] {
                for comfort in [MovementComfort.limited, .okay, .good] {
                    for unlocked in [false, true] {
                        let safetyAnswer: ConditionalSafetyAnswer? =
                            change == .worse || comfort == .limited ? .no : nil
                        let expected = AreaLevelRule.level(
                            changeReport: change,
                            movementComfort: comfort,
                            activeUnlocked: unlocked
                        )
                        var results: [SelectedPlan] = []
                        for duration in [DurationVariant.quick, .standard] {
                            let request = try request(
                                primaryArea: area,
                                primaryCheckIn: checkIn(
                                    area: area,
                                    change: change,
                                    comfort: comfort,
                                    safetyAnswer: safetyAnswer
                                ),
                                historyByArea: try history(area: area, unlocked: unlocked),
                                duration: duration
                            )
                            let plan = try selectedPlan(from: engine().select(request))
                            #expect(plan.recommendedLevel == expected)
                            #expect(plan.selectedLevel == expected)
                            #expect(plan.includedAreaDecisions.count == 1)
                            #expect(plan.includedAreaDecisions.first?.area == area)
                            results.append(plan)
                        }
                        let quick = try #require(results.first)
                        let standard = try #require(results.last)
                        #expect(quick.recommendedLevel == standard.recommendedLevel)
                        #expect(quick.selectedLevel == standard.selectedLevel)
                        #expect(quick.includedAreaDecisions == standard.includedAreaDecisions)
                        #expect(quick.explanations == standard.explanations)
                        #expect(quick.pauseTodayAvailable == standard.pauseTodayAvailable)
                    }
                }
            }
        }
    }

    @Test("Conditional safety answers fail closed")
    private func conditionalSafetyMatrix() throws {
        for answer in [ConditionalSafetyAnswer.yes, .notSure] {
            let result = engine().select(
                try request(
                    primaryCheckIn: checkIn(
                        area: .neck,
                        change: .worse,
                        comfort: .good,
                        safetyAnswer: answer
                    )
                )
            )
            let noPlan = try noPlan(from: result)
            #expect(noPlan.reason == .attentionRequired)
            #expect(noPlan.affectedAreas == [.neck])
            #expect(noPlan.transitions.count == 1)
            #expect(noPlan.transitions.first?.answer == answer)
        }

        let pending = try noPlan(
            from: engine().select(
                try request(
                    primaryCheckIn: checkIn(
                        area: .neck,
                        change: .similar,
                        comfort: .limited,
                        safetyAnswer: nil
                    )
                )
            )
        )
        #expect(pending.reason == .needsPrimaryConditionalSafetyAnswer)
        #expect(pending.transitions.isEmpty)
    }

    @Test("All two-area safety-answer pairs block when either area flags Attention")
    private func twoAreaSafetyMatrix() throws {
        let answers = [
            ConditionalSafetyAnswer.no,
            ConditionalSafetyAnswer.yes,
            ConditionalSafetyAnswer.notSure
        ]
        for primaryAnswer in answers {
            for secondaryAnswer in answers {
                let result = engine().select(
                    try request(
                        secondaryArea: .upperMidBack,
                        secondaryParticipation: .include,
                        primaryCheckIn: checkIn(
                            area: .neck,
                            change: .worse,
                            comfort: .good,
                            safetyAnswer: primaryAnswer
                        ),
                        secondaryCheckIn: checkIn(
                            area: .upperMidBack,
                            change: .worse,
                            comfort: .good,
                            safetyAnswer: secondaryAnswer,
                            role: .secondary
                        ),
                        requestedOverride: .active
                    )
                )
                let flaggedAreas = [
                    primaryAnswer == .no ? nil : BodyArea.neck,
                    secondaryAnswer == .no ? nil : BodyArea.upperMidBack
                ].compactMap { $0 }
                if flaggedAreas.isEmpty {
                    let plan = try selectedPlan(from: result)
                    #expect(plan.recommendedLevel == .gentle)
                    #expect(plan.overrideDisposition == .rejectedHigher)
                } else {
                    let blocked = try noPlan(from: result)
                    #expect(blocked.reason == .attentionRequired)
                    #expect(blocked.affectedAreas == flaggedAreas)
                    #expect(blocked.transitions.map(\.area) == flaggedAreas)
                }
            }
        }
    }

    @Test("Persisted Attention blocks globally in deterministic order")
    private func persistedAttentionIsGlobal() throws {
        let safety = normalSafety(updating: [.lowerBack: .attentionRequired, .neck: .attentionRequired])
        let result = engine().select(try request(safetyByArea: safety))
        let noPlan = try noPlan(from: result)

        #expect(noPlan.reason == .attentionRequired)
        #expect(noPlan.affectedAreas == [.neck, .lowerBack])
        #expect(noPlan.transitions.isEmpty)
    }

    @Test("A secondary trigger cannot be skipped")
    private func secondaryTriggerCannotBeSkipped() throws {
        let secondary = try checkIn(
            area: .upperMidBack,
            change: .worse,
            comfort: .okay,
            safetyAnswer: nil,
            role: .secondary
        )
        let result = engine().select(
            try request(
                secondaryArea: .upperMidBack,
                secondaryParticipation: .skipForSession,
                secondaryCheckIn: secondary
            )
        )
        let noPlan = try noPlan(from: result)
        #expect(noPlan.reason == .needsSecondaryConditionalSafetyAnswer)
        #expect(noPlan.affectedAreas == [.upperMidBack])
    }

    @Test("Secondary skips are explicit and an answered trigger preserves Pause eligibility")
    private func secondarySkipIsExplicit() throws {
        let skippedBeforeAnswers = try selectedPlan(
            from: engine().select(
                try request(
                    secondaryArea: .upperMidBack,
                    secondaryParticipation: .skipForSession
                )
            )
        )
        #expect(skippedBeforeAnswers.includedAreaDecisions.map(\.area) == [.neck])
        #expect(!skippedBeforeAnswers.pauseTodayAvailable)

        let secondary = try checkIn(
            area: .upperMidBack,
            change: .worse,
            comfort: .okay,
            safetyAnswer: .no,
            role: .secondary
        )
        let plan = try selectedPlan(
            from: engine().select(
                try request(
                    secondaryArea: .upperMidBack,
                    secondaryParticipation: .skipForSession,
                    secondaryCheckIn: secondary
                )
            )
        )

        #expect(plan.includedAreaDecisions.map(\.area) == [.neck])
        #expect(plan.omittedAreas.map(\.area) == [.upperMidBack])
        #expect(plan.omittedAreas.map(\.reason) == [.secondaryUnanswered])
        #expect(plan.notices.map(\.key) == [.secondarySkipped])
        #expect(plan.notices.map(\.area) == [.upperMidBack])
        #expect(plan.pauseTodayAvailable)
        #expect(plan.compositionRequest.secondaryArea == nil)
    }

    @Test("Missing check-ins return exact continuation states")
    private func missingCheckIns() throws {
        let missingPrimary = try noPlan(
            from: engine().select(try request(includePrimaryCheckIn: false))
        )
        #expect(missingPrimary.reason == .needsPrimaryCheckIn)

        let missingSecondary = try noPlan(
            from: engine().select(
                try request(
                    secondaryArea: .upperMidBack,
                    secondaryParticipation: .include,
                    secondaryCheckIn: nil
                )
            )
        )
        #expect(missingSecondary.reason == .needsSecondaryCheckIn)
    }

    @Test("Structural errors return invalid input", arguments: InvalidInputCase.allCases)
    private func invalidInput(testCase: InvalidInputCase) throws {
        let result: PlanSelectionResult
        switch testCase {
        case .unsupportedRules:
            result = engine().select(try request(rulesVersion: "future-rules"))
        case .invalidDecisionRevision:
            result = engine().select(try request(decisionRevision: 0))
        case .missingSecondaryParticipation:
            result = engine().select(
                try request(secondaryArea: .upperMidBack, secondaryParticipation: nil)
            )
        case .unexpectedSecondaryParticipation:
            result = engine().select(
                try request(secondaryArea: nil, secondaryParticipation: .include)
            )
        case .duplicateArea:
            result = engine().select(
                try request(secondaryArea: .neck, secondaryParticipation: .include)
            )
        case .straySafetyAnswer:
            result = engine().select(
                try request(
                    primaryCheckIn: checkIn(
                        area: .neck,
                        change: .similar,
                        comfort: .good,
                        safetyAnswer: .yes
                    )
                )
            )
        case .missingSafetyArea:
            var safety = normalSafety()
            safety[.lowerBack] = nil
            result = engine().select(try request(safetyByArea: safety))
        case .mismatchedSafetyArea:
            var safety = normalSafety()
            safety[.neck] = SelectionSafetySnapshot(area: .lowerBack, status: .normal)
            result = engine().select(try request(safetyByArea: safety))
        case .mismatchedCheckInArea:
            result = engine().select(
                try request(primaryCheckIn: checkIn(area: .lowerBack))
            )
        case .mismatchedHistoryArea:
            let mismatched = try ActiveHistoryState(
                area: .lowerBack,
                qualifyingOutcomeCount: 0,
                mostRecentRecordedResponse: nil
            )
            result = engine().select(try request(historyByArea: [.neck: mismatched]))
        case .duplicateEntryID:
            let sharedID = try entryID(for: .primary)
            result = engine().select(
                try request(
                    secondaryArea: .upperMidBack,
                    secondaryParticipation: .include,
                    primaryCheckIn: checkIn(area: .neck, id: sharedID),
                    secondaryCheckIn: checkIn(
                        area: .upperMidBack,
                        id: sharedID,
                        role: .secondary
                    )
                )
            )
        }

        let noPlan = try noPlan(from: result)
        #expect(noPlan.reason == .invalidInput)
        #expect(noPlan.affectedAreas.isEmpty)
        #expect(noPlan.transitions.isEmpty)
    }

    @Test("All two-area level pairs reduce to the gentler result")
    private func exhaustiveTwoAreaReduction() throws {
        let areas = PrototypeSelectionRules.supportedAreas
        for primary in areas {
            for secondary in areas where secondary != primary {
                for primaryLevel in RoutineLevel.allCases {
                    for secondaryLevel in RoutineLevel.allCases {
                        for duration in [DurationVariant.quick, .standard] {
                            let primaryInput = input(for: primaryLevel)
                            let secondaryInput = input(for: secondaryLevel)
                            let histories = try histories(
                                primary: primary,
                                primaryUnlocked: primaryInput.unlocked,
                                secondary: secondary,
                                secondaryUnlocked: secondaryInput.unlocked
                            )
                            let plan = try selectedPlan(
                                from: engine().select(
                                    try request(
                                        primaryArea: primary,
                                        secondaryArea: secondary,
                                        secondaryParticipation: .include,
                                        primaryCheckIn: checkIn(
                                            area: primary,
                                            change: primaryInput.change,
                                            comfort: primaryInput.comfort,
                                            safetyAnswer: primaryInput.safetyAnswer
                                        ),
                                        secondaryCheckIn: checkIn(
                                            area: secondary,
                                            change: secondaryInput.change,
                                            comfort: secondaryInput.comfort,
                                            safetyAnswer: secondaryInput.safetyAnswer,
                                            role: .secondary
                                        ),
                                        historyByArea: histories,
                                        duration: duration
                                    )
                                )
                            )
                            #expect(plan.recommendedLevel == min(primaryLevel, secondaryLevel))
                            #expect(plan.compositionRequest.secondaryArea == secondary)
                        }
                    }
                }
            }
        }
    }

    @Test("Every override pair follows the gentler-only contract")
    private func exhaustiveOverrides() throws {
        for recommended in RoutineLevel.allCases {
            let input = input(for: recommended)
            for requested in RoutineLevel.allCases {
                let plan = try selectedPlan(
                    from: engine().select(
                        try request(
                            primaryCheckIn: checkIn(
                                area: .neck,
                                change: input.change,
                                comfort: input.comfort,
                                safetyAnswer: input.safetyAnswer
                            ),
                            historyByArea: try history(area: .neck, unlocked: input.unlocked),
                            requestedOverride: requested
                        )
                    )
                )
                let expectedLevel = min(recommended, requested)
                let expectedDisposition: OverrideDisposition = if requested < recommended {
                    .acceptedGentler
                } else if requested == recommended {
                    .sameAsRecommended
                } else {
                    .rejectedHigher
                }
                #expect(plan.selectedLevel == expectedLevel)
                #expect(plan.overrideDisposition == expectedDisposition)
                #expect(plan.compositionRequest.selectedLevel == expectedLevel)
            }
        }
    }

    @Test("Explanations are stable, prioritized, and bounded")
    private func explanationsAreBounded() throws {
        let active = input(for: .active)
        let balanced = input(for: .balanced)
        let plan = try selectedPlan(
            from: engine().select(
                try request(
                    secondaryArea: .upperMidBack,
                    secondaryParticipation: .include,
                    primaryCheckIn: checkIn(
                        area: .neck,
                        change: active.change,
                        comfort: active.comfort,
                        safetyAnswer: active.safetyAnswer
                    ),
                    secondaryCheckIn: checkIn(
                        area: .upperMidBack,
                        change: balanced.change,
                        comfort: balanced.comfort,
                        safetyAnswer: balanced.safetyAnswer,
                        role: .secondary
                    ),
                    historyByArea: try histories(
                        primary: .neck,
                        primaryUnlocked: true,
                        secondary: .upperMidBack,
                        secondaryUnlocked: false
                    ),
                    requestedOverride: .gentle
                )
            )
        )

        #expect(plan.explanations.map(\.key) == [.userGentlerOverride, .balancedCheckIn])
        #expect(plan.explanations.count == 2)
    }

    @Test("Missing history locks Active without blocking selection")
    private func missingHistoryLocksActive() throws {
        let plan = try selectedPlan(
            from: engine().select(
                try request(
                    primaryCheckIn: checkIn(
                        area: .neck,
                        change: .better,
                        comfort: .good,
                        safetyAnswer: nil
                    ),
                    historyByArea: [:]
                )
            )
        )
        #expect(plan.recommendedLevel == .balanced)
        #expect(plan.explanations.map(\.key) == [.activeLocked])
    }

    @Test("Excluded context cannot influence repeated selection")
    private func excludedContextHasNoInfluence() throws {
        let contexts = [
            ExcludedSelectionContext(
                healthValue: nil,
                telemetryEnabled: false,
                reminderEnabled: false,
                connected: false,
                availableMinutes: 1,
                occupation: "desk",
                consistencyDays: 0
            ),
            ExcludedSelectionContext(
                healthValue: 100,
                telemetryEnabled: true,
                reminderEnabled: true,
                connected: true,
                availableMinutes: 90,
                occupation: "manual",
                consistencyDays: 365
            )
        ]
        let fixedRequest = try request(
            primaryCheckIn: checkIn(
                area: .neck,
                change: .better,
                comfort: .good,
                safetyAnswer: nil
            ),
            historyByArea: try history(area: .neck, unlocked: true)
        )
        let expected = engine().select(fixedRequest)

        for context in contexts {
            _ = context
            #expect(engine().select(fixedRequest) == expected)
        }
    }

    private func engine() -> PlanSelectionEngine {
        .prototype
    }

    private func request(
        decisionRevision: Int = Self.validRevision,
        primaryArea: BodyArea = .neck,
        secondaryArea: BodyArea? = nil,
        secondaryParticipation: SecondaryParticipation? = nil,
        includePrimaryCheckIn: Bool = true,
        primaryCheckIn: SelectionAreaCheckIn? = nil,
        secondaryCheckIn: SelectionAreaCheckIn? = nil,
        safetyByArea: [BodyArea: SelectionSafetySnapshot]? = nil,
        historyByArea: [BodyArea: ActiveHistoryState] = [:],
        requestedOverride: RoutineLevel? = nil,
        duration: DurationVariant = .standard,
        rulesVersion: String = PrototypeSelectionRules.version
    ) throws -> PlanSelectionRequest {
        var checkIns: [BodyArea: SelectionAreaCheckIn] = [:]
        let resolvedPrimary: SelectionAreaCheckIn? = if includePrimaryCheckIn {
            try primaryCheckIn ?? checkIn(area: primaryArea)
        } else {
            nil
        }
        if let resolvedPrimary {
            checkIns[primaryArea] = resolvedPrimary
        }
        if let secondaryCheckIn, let secondaryArea {
            checkIns[secondaryArea] = secondaryCheckIn
        }
        return PlanSelectionRequest(
            decisionID: try selectionDecisionID(),
            checkInID: try checkInID(),
            decisionRevision: decisionRevision,
            primaryArea: primaryArea,
            secondaryArea: secondaryArea,
            secondaryParticipation: secondaryParticipation,
            checkInsByArea: checkIns,
            safetyByArea: safetyByArea ?? normalSafety(),
            historyByArea: historyByArea,
            requestedOverride: requestedOverride,
            duration: duration,
            rulesVersion: rulesVersion,
            catalogVersion: try NonEmptyString(validating: Self.catalogVersion)
        )
    }

    private func checkIn(
        area: BodyArea,
        id: CheckInEntryID? = nil,
        change: ChangeReport = .similar,
        comfort: MovementComfort = .good,
        safetyAnswer: ConditionalSafetyAnswer? = nil,
        role: AreaRole = .primary
    ) throws -> SelectionAreaCheckIn {
        SelectionAreaCheckIn(
            checkInEntryID: try id ?? entryID(for: role),
            entryRevision: Self.validRevision,
            area: area,
            changeReport: change,
            movementComfort: comfort,
            conditionalSafetyAnswer: safetyAnswer
        )
    }

    private func normalSafety(
        updating changes: [BodyArea: SafetyStatus] = [:]
    ) -> [BodyArea: SelectionSafetySnapshot] {
        Dictionary(uniqueKeysWithValues: PrototypeSelectionRules.supportedAreas.map { area in
            (area, SelectionSafetySnapshot(area: area, status: changes[area] ?? .normal))
        })
    }

    private func history(area: BodyArea, unlocked: Bool) throws -> [BodyArea: ActiveHistoryState] {
        [
            area: try ActiveHistoryState(
                area: area,
                qualifyingOutcomeCount: unlocked
                    ? PrototypeSelectionRules.qualifyingOutcomeCountRequired
                    : 0,
                mostRecentRecordedResponse: nil
            )
        ]
    }

    private func histories(
        primary: BodyArea,
        primaryUnlocked: Bool,
        secondary: BodyArea,
        secondaryUnlocked: Bool
    ) throws -> [BodyArea: ActiveHistoryState] {
        try history(area: primary, unlocked: primaryUnlocked).merging(
            history(area: secondary, unlocked: secondaryUnlocked),
            uniquingKeysWith: { current, _ in current }
        )
    }

    private func input(for level: RoutineLevel) -> LevelInput {
        switch level {
        case .gentle:
            LevelInput(change: .worse, comfort: .good, safetyAnswer: .no, unlocked: false)
        case .balanced:
            LevelInput(change: .similar, comfort: .good, safetyAnswer: nil, unlocked: false)
        case .active:
            LevelInput(change: .better, comfort: .good, safetyAnswer: nil, unlocked: true)
        }
    }

    private func selectedPlan(from result: PlanSelectionResult) throws -> SelectedPlan {
        guard case let .selected(plan) = result else { throw FixtureError.expectedSelection }
        return plan
    }

    private func noPlan(
        from result: PlanSelectionResult
    ) throws -> (
        reason: NoPlanReason,
        affectedAreas: [BodyArea],
        transitions: [SelectionSafetyTransition]
    ) {
        guard case let .noPlan(reason, areas, transitions) = result else {
            throw FixtureError.expectedNoPlan
        }
        return (reason, areas, transitions)
    }

    private func selectionDecisionID() throws -> SelectionDecisionID {
        try SelectionDecisionID(validating: "00000000-0000-0000-0000-000000000001")
    }

    private func checkInID() throws -> CheckInID {
        try CheckInID(validating: "00000000-0000-0000-0000-000000000002")
    }

    private func entryID(for role: AreaRole) throws -> CheckInEntryID {
        let rawValue = switch role {
        case .primary: "00000000-0000-0000-0000-000000000003"
        case .secondary: "00000000-0000-0000-0000-000000000004"
        }
        return try CheckInEntryID(validating: rawValue)
    }
}
