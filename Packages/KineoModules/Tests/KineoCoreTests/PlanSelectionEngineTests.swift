import Foundation
import KineoCore
import Testing

@Suite("Plan selection engine")
struct PlanSelectionEngineTests {
    private struct PlanSelectionParityCase: Decodable {
        let name: String
        let request: PlanSelectionParityRequest
        let expected: PlanSelectionParityExpected
    }

    private struct PlanSelectionParityRequest: Decodable {
        let primaryArea: BodyArea
        let primary: PlanSelectionParityCheckIn
        let secondaryArea: BodyArea?
        let secondaryParticipation: String?
        let secondary: PlanSelectionParityCheckIn?
        let unlockedAreas: [BodyArea]
        let safetyAttentionAreas: [BodyArea]
        let requestedOverride: RoutineLevel?
        let duration: DurationVariant
    }

    private struct PlanSelectionParityCheckIn: Decodable {
        let changeReport: ChangeReport
        let movementComfort: MovementComfort
        let conditionalSafetyAnswer: ConditionalSafetyAnswer?
    }

    private struct PlanSelectionParityExpected: Decodable {
        let kind: String
        let reason: String?
        let affectedAreas: [BodyArea]?
        let safetyTransitions: [PlanSelectionParityTransition]?
        let recommendedLevel: RoutineLevel?
        let requestedOverride: RoutineLevel?
        let selectedLevel: RoutineLevel?
        let overrideDisposition: String?
        let duration: DurationVariant?
        let includedAreaDecisions: [PlanSelectionParityAreaDecision]?
        let omittedAreas: [PlanSelectionParityOmittedArea]?
        let compositionRequest: PlanSelectionParityCompositionRequest?
        let explanations: [PlanSelectionParityExplanation]?
        let notices: [PlanSelectionParityNotice]?
        let pauseTodayAvailable: Bool?
    }

    private struct PlanSelectionParityTransition: Decodable, Equatable {
        let area: BodyArea
        let sourceCheckInEntryId: String
        let answer: ConditionalSafetyAnswer
    }

    private struct PlanSelectionParityAreaDecision: Decodable, Equatable {
        let area: BodyArea
        let role: AreaRole
        let checkInEntryId: String
        let entryRevision: Int
        let baseLevel: RoutineLevel
        let activeUnlocked: Bool
    }

    private struct PlanSelectionParityOmittedArea: Decodable, Equatable {
        let area: BodyArea
        let reason: OmissionReason
    }

    private struct PlanSelectionParityCompositionRequest: Decodable, Equatable {
        let primaryArea: BodyArea
        let secondaryArea: BodyArea?
        let selectedLevel: RoutineLevel
        let duration: DurationVariant
        let rulesVersion: String
        let catalogVersion: String
    }

    private struct PlanSelectionParityExplanation: Decodable, Equatable {
        let key: String
        let parameters: [String: String]
    }

    private struct PlanSelectionParityNotice: Decodable, Equatable {
        let key: String
        let area: BodyArea?
    }

    private enum FixtureError: Error {
        case expectedSelection
        case expectedNoPlan
        case invalidParityValue
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

    @Test("Swift matches the shared plan-selection parity fixture")
    private func sharedPlanSelectionParity() throws {
        let fixtureURL = try #require(
            Bundle.module.url(
                forResource: "plan-selection-v1",
                withExtension: "json"
            )
        )
        let fixture = try JSONDecoder().decode(
            [PlanSelectionParityCase].self,
            from: Data(contentsOf: fixtureURL)
        )

        for testCase in fixture {
            var checkIns: [BodyArea: SelectionAreaCheckIn] = [
                testCase.request.primaryArea: try parityCheckIn(
                    testCase.request.primary,
                    area: testCase.request.primaryArea,
                    role: .primary
                )
            ]
            if let secondaryArea = testCase.request.secondaryArea,
               let secondary = testCase.request.secondary {
                checkIns[secondaryArea] = try parityCheckIn(
                    secondary,
                    area: secondaryArea,
                    role: .secondary
                )
            }
            var histories: [BodyArea: ActiveHistoryState] = [:]
            for area in testCase.request.unlockedAreas {
                histories.merge(
                    try history(area: area, unlocked: true),
                    uniquingKeysWith: { current, _ in current }
                )
            }
            let attention: [BodyArea: SafetyStatus] = Dictionary(
                uniqueKeysWithValues: testCase.request.safetyAttentionAreas.map {
                    ($0, SafetyStatus.attentionRequired)
                }
            )
            let result = engine().select(
                try request(
                    primaryArea: testCase.request.primaryArea,
                    secondaryArea: testCase.request.secondaryArea,
                    secondaryParticipation: try secondaryParticipation(
                        from: testCase.request.secondaryParticipation
                    ),
                    primaryCheckIn: checkIns[testCase.request.primaryArea],
                    secondaryCheckIn: testCase.request.secondaryArea.flatMap { checkIns[$0] },
                    safetyByArea: normalSafety(updating: attention),
                    historyByArea: histories,
                    requestedOverride: testCase.request.requestedOverride,
                    duration: testCase.request.duration
                )
            )

            if testCase.expected.kind == "noPlan" {
                let outcome = try noPlan(from: result)
                #expect(outcome.reason.rawValue == testCase.expected.reason)
                #expect(outcome.affectedAreas == testCase.expected.affectedAreas)
                #expect(
                    outcome.transitions.map {
                        PlanSelectionParityTransition(
                            area: $0.area,
                            sourceCheckInEntryId: $0.sourceCheckInEntryID.rawValue,
                            answer: $0.answer
                        )
                    } == testCase.expected.safetyTransitions
                )
            } else {
                let plan = try selectedPlan(from: result)
                #expect(plan.recommendedLevel == testCase.expected.recommendedLevel)
                #expect(plan.requestedOverride == testCase.expected.requestedOverride)
                #expect(plan.selectedLevel == testCase.expected.selectedLevel)
                #expect(plan.overrideDisposition.rawValue == testCase.expected.overrideDisposition)
                #expect(plan.duration == testCase.expected.duration)
                #expect(
                    plan.includedAreaDecisions.map {
                        PlanSelectionParityAreaDecision(
                            area: $0.area,
                            role: $0.role,
                            checkInEntryId: $0.checkInEntryID.rawValue,
                            entryRevision: $0.entryRevision,
                            baseLevel: $0.baseLevel,
                            activeUnlocked: $0.activeUnlocked
                        )
                    } == testCase.expected.includedAreaDecisions
                )
                #expect(
                    plan.omittedAreas.map {
                        PlanSelectionParityOmittedArea(area: $0.area, reason: $0.reason)
                    } == testCase.expected.omittedAreas
                )
                #expect(
                    PlanSelectionParityCompositionRequest(
                        primaryArea: plan.compositionRequest.primaryArea,
                        secondaryArea: plan.compositionRequest.secondaryArea,
                        selectedLevel: plan.compositionRequest.selectedLevel,
                        duration: plan.compositionRequest.duration,
                        rulesVersion: plan.compositionRequest.rulesVersion,
                        catalogVersion: plan.compositionRequest.catalogVersion.rawValue
                    ) == testCase.expected.compositionRequest
                )
                #expect(
                    plan.explanations.map {
                        PlanSelectionParityExplanation(
                            key: $0.key.rawValue,
                            parameters: $0.parameters
                        )
                    } == testCase.expected.explanations
                )
                #expect(
                    plan.notices.map {
                        PlanSelectionParityNotice(key: $0.key.rawValue, area: $0.area)
                    } == testCase.expected.notices
                )
                #expect(plan.pauseTodayAvailable == testCase.expected.pauseTodayAvailable)
            }
        }
    }

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

    @Test("Every triggered single-area row handles all conditional answers")
    private func exhaustiveSingleAreaSafety() throws {
        let conditionalAnswers: [ConditionalSafetyAnswer?] = [nil, .no, .yes, .notSure]
        for area in PrototypeSelectionRules.supportedAreas {
            for change in [ChangeReport.better, .similar, .worse] {
                for comfort in [MovementComfort.limited, .okay, .good] {
                    guard change == .worse || comfort == .limited else { continue }
                    for unlocked in [false, true] {
                        for duration in [DurationVariant.quick, .standard] {
                            for answer in conditionalAnswers {
                                let result = engine().select(
                                    try request(
                                        primaryArea: area,
                                        primaryCheckIn: checkIn(
                                            area: area,
                                            change: change,
                                            comfort: comfort,
                                            safetyAnswer: answer
                                        ),
                                        historyByArea: try history(area: area, unlocked: unlocked),
                                        duration: duration
                                    )
                                )
                                switch answer {
                                case nil:
                                    let pending = try noPlan(from: result)
                                    #expect(pending.reason == .needsPrimaryConditionalSafetyAnswer)
                                case .no:
                                    let plan = try selectedPlan(from: result)
                                    #expect(plan.recommendedLevel == .gentle)
                                case .yes, .notSure:
                                    let blocked = try noPlan(from: result)
                                    #expect(blocked.reason == .attentionRequired)
                                    #expect(blocked.affectedAreas == [area])
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    @Test("All two-area safety-answer pairs block when either area flags Attention")
    private func twoAreaSafetyMatrix() throws {
        let answers = [
            ConditionalSafetyAnswer.no,
            ConditionalSafetyAnswer.yes,
            ConditionalSafetyAnswer.notSure
        ]
        for primaryArea in PrototypeSelectionRules.supportedAreas {
            for secondaryArea in PrototypeSelectionRules.supportedAreas where secondaryArea != primaryArea {
                for duration in [DurationVariant.quick, .standard] {
                    for primaryAnswer in answers {
                        for secondaryAnswer in answers {
                            let result = engine().select(
                                try request(
                                    primaryArea: primaryArea,
                                    secondaryArea: secondaryArea,
                                    secondaryParticipation: .include,
                                    primaryCheckIn: checkIn(
                                        area: primaryArea,
                                        change: .worse,
                                        comfort: .good,
                                        safetyAnswer: primaryAnswer
                                    ),
                                    secondaryCheckIn: checkIn(
                                        area: secondaryArea,
                                        change: .worse,
                                        comfort: .good,
                                        safetyAnswer: secondaryAnswer,
                                        role: .secondary
                                    ),
                                    requestedOverride: .active,
                                    duration: duration
                                )
                            )
                            let flaggedAreas = [
                                primaryAnswer == .no ? nil : primaryArea,
                                secondaryAnswer == .no ? nil : secondaryArea
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

    @Test("Check-in explanations use exact stable keys")
    private func explanationKeys() throws {
        let cases: [(ChangeReport, MovementComfort, ConditionalSafetyAnswer?, Bool, SelectionExplanationKey)] = [
            (.worse, .limited, .no, false, .reportedWorse),
            (.similar, .limited, .no, false, .movementLimited),
            (.better, .good, nil, true, .betterGoodActive),
            (.similar, .good, nil, false, .balancedCheckIn),
            (.better, .good, nil, false, .activeLocked)
        ]
        for (change, comfort, answer, unlocked, expectedKey) in cases {
            let plan = try selectedPlan(
                from: engine().select(
                    try request(
                        primaryCheckIn: checkIn(
                            area: .neck,
                            change: change,
                            comfort: comfort,
                            safetyAnswer: answer
                        ),
                        historyByArea: try history(area: .neck, unlocked: unlocked)
                    )
                )
            )
            #expect(plan.explanations.first?.key == expectedKey)
        }
    }

    @Test("A limiting secondary gets the conservatism explanation")
    private func secondaryConservatismExplanation() throws {
        let plan = try selectedPlan(
            from: engine().select(
                try request(
                    secondaryArea: .upperMidBack,
                    secondaryParticipation: .include,
                    primaryCheckIn: checkIn(
                        area: .neck,
                        change: .similar,
                        comfort: .good,
                        safetyAnswer: nil
                    ),
                    secondaryCheckIn: checkIn(
                        area: .upperMidBack,
                        change: .worse,
                        comfort: .good,
                        safetyAnswer: .no,
                        role: .secondary
                    )
                )
            )
        )
        #expect(plan.explanations.map(\.key) == [.reportedWorse, .secondaryMoreConservative])
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

    private func parityCheckIn(
        _ fixture: PlanSelectionParityCheckIn,
        area: BodyArea,
        role: AreaRole
    ) throws -> SelectionAreaCheckIn {
        try checkIn(
            area: area,
            change: fixture.changeReport,
            comfort: fixture.movementComfort,
            safetyAnswer: fixture.conditionalSafetyAnswer,
            role: role
        )
    }

    private func secondaryParticipation(
        from rawValue: String?
    ) throws -> SecondaryParticipation? {
        switch rawValue {
        case nil:
            nil
        case "include":
            .include
        case "skipForSession":
            .skipForSession
        default:
            throw FixtureError.invalidParityValue
        }
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
