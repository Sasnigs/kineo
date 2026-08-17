import KineoCore
import Testing

@Suite("Selection rules")
struct SelectionRulesTests {
    private struct LevelCase: Sendable {
        let change: ChangeReport
        let comfort: MovementComfort
        let locked: RoutineLevel
        let unlocked: RoutineLevel
    }

    private static let levelCases = [
        LevelCase(change: .better, comfort: .limited, locked: .gentle, unlocked: .gentle),
        LevelCase(change: .better, comfort: .okay, locked: .balanced, unlocked: .balanced),
        LevelCase(change: .better, comfort: .good, locked: .balanced, unlocked: .active),
        LevelCase(change: .similar, comfort: .limited, locked: .gentle, unlocked: .gentle),
        LevelCase(change: .similar, comfort: .okay, locked: .balanced, unlocked: .balanced),
        LevelCase(change: .similar, comfort: .good, locked: .balanced, unlocked: .balanced),
        LevelCase(change: .worse, comfort: .limited, locked: .gentle, unlocked: .gentle),
        LevelCase(change: .worse, comfort: .okay, locked: .gentle, unlocked: .gentle),
        LevelCase(change: .worse, comfort: .good, locked: .gentle, unlocked: .gentle)
    ]

    @Test("Base mapping is exhaustive", arguments: levelCases)
    private func baseMapping(testCase: LevelCase) {
        #expect(
            AreaLevelRule.level(
                changeReport: testCase.change,
                movementComfort: testCase.comfort,
                activeUnlocked: false
            ) == testCase.locked
        )
        #expect(
            AreaLevelRule.level(
                changeReport: testCase.change,
                movementComfort: testCase.comfort,
                activeUnlocked: true
            ) == testCase.unlocked
        )
    }

    @Test("Routine levels use stable explicit ranks")
    func routineLevelRanks() {
        #expect(RoutineLevel.gentle.selectionRank < RoutineLevel.balanced.selectionRank)
        #expect(RoutineLevel.balanced.selectionRank < RoutineLevel.active.selectionRank)
        #expect(min(RoutineLevel.active, RoutineLevel.gentle) == .gentle)
    }

    @Test("Only completed Gentle or Balanced with Better or Same increments", arguments: [
        (RoutineLevel.gentle, AreaResponse.better),
        (RoutineLevel.gentle, AreaResponse.same),
        (RoutineLevel.balanced, AreaResponse.better),
        (RoutineLevel.balanced, AreaResponse.same)
    ])
    func qualifyingOutcome(level: RoutineLevel, response: AreaResponse) throws {
        let result = try reducer().reducing(
            state(),
            with: outcome(status: .completed, level: level, response: response)
        )
        #expect(result.qualifyingOutcomeCount == 1)
        #expect(result.mostRecentRecordedResponse == response)
    }

    @Test("Nonqualifying outcomes preserve count and update only explicit response", arguments: [
        (RoutineStatus.completed, RoutineLevel.active, AreaResponse.better),
        (RoutineStatus.stopped, RoutineLevel.gentle, AreaResponse.same),
        (RoutineStatus.abandoned, RoutineLevel.balanced, AreaResponse.better),
        (RoutineStatus.safetyStopped, RoutineLevel.gentle, AreaResponse.same)
    ])
    func nonqualifyingOutcome(
        status: RoutineStatus,
        level: RoutineLevel,
        response: AreaResponse
    ) throws {
        let previous = try state(count: 1, latest: .better)
        let result = try reducer().reducing(
            previous,
            with: outcome(status: status, level: level, response: response)
        )
        #expect(result.qualifyingOutcomeCount == previous.qualifyingOutcomeCount)
        #expect(result.mostRecentRecordedResponse == response)
    }

    @Test("Worse resets any terminal outcome")
    func worseResets() throws {
        let result = try reducer().reducing(
            state(count: PrototypeSelectionRules.qualifyingOutcomeCountRequired, latest: .better),
            with: outcome(status: .stopped, level: .active, response: .worse)
        )
        #expect(result.qualifyingOutcomeCount == 0)
        #expect(result.mostRecentRecordedResponse == .worse)
    }

    @Test("Skipped feedback preserves count and latest response")
    func skippedFeedbackPreservesHistory() throws {
        let previous = try state(count: 1, latest: .same)
        let result = try reducer().reducing(
            previous,
            with: outcome(status: .completed, level: .gentle, response: nil)
        )
        #expect(result == previous)
    }

    @Test("Two qualifying outcomes unlock only their own area")
    func unlockIsAreaSpecific() throws {
        let configuration = try ActiveUnlockConfiguration()
        let historyReducer = ActiveHistoryReducer(configuration: configuration)
        let first = try historyReducer.reducing(
            state(),
            with: outcome(status: .completed, level: .gentle, response: .better)
        )
        let second = try historyReducer.reducing(
            first,
            with: outcome(status: .completed, level: .balanced, response: .same)
        )
        let otherArea = try state(area: .lowerBack)

        #expect(second.isActiveUnlocked(using: configuration))
        #expect(!otherArea.isActiveUnlocked(using: configuration))
    }

    @Test("Inconsistent history events fail explicitly", arguments: [
        ActiveHistoryReductionError.areaMismatch,
        ActiveHistoryReductionError.areaNotIncluded,
        ActiveHistoryReductionError.nonterminalRoutine
    ])
    func invalidOutcome(expectedError: ActiveHistoryReductionError) throws {
        let invalid: RoutineAreaOutcome
        switch expectedError {
        case .areaMismatch:
            invalid = outcome(area: .lowerBack, status: .completed, level: .gentle, response: .better)
        case .areaNotIncluded:
            invalid = outcome(
                status: .completed,
                level: .gentle,
                response: .better,
                wasIncluded: false
            )
        case .nonterminalRoutine:
            invalid = outcome(status: .inProgress, level: .gentle, response: .better)
        case .qualifyingCountOverflow:
            Issue.record("Overflow has a dedicated test.")
            return
        }

        #expect(throws: expectedError) {
            try reducer().reducing(state(), with: invalid)
        }
    }

    @Test("Qualifying count overflow is reported")
    func countOverflow() throws {
        #expect(throws: ActiveHistoryReductionError.qualifyingCountOverflow) {
            try reducer().reducing(
                state(count: .max),
                with: outcome(status: .completed, level: .gentle, response: .better)
            )
        }
    }

    private func reducer() throws -> ActiveHistoryReducer {
        ActiveHistoryReducer(configuration: try ActiveUnlockConfiguration())
    }

    private func state(
        area: BodyArea = .neck,
        count: Int = 0,
        latest: AreaResponse? = nil
    ) throws -> ActiveHistoryState {
        try ActiveHistoryState(
            area: area,
            qualifyingOutcomeCount: count,
            mostRecentRecordedResponse: latest
        )
    }

    private func outcome(
        area: BodyArea = .neck,
        status: RoutineStatus,
        level: RoutineLevel,
        response: AreaResponse?,
        wasIncluded: Bool = true
    ) -> RoutineAreaOutcome {
        RoutineAreaOutcome(
            area: area,
            routineStatus: status,
            deliveredLevel: level,
            response: response,
            wasIncludedInDeliveredRoutine: wasIncluded
        )
    }
}
