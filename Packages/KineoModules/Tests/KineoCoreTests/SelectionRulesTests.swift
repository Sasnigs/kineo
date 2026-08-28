import Foundation
import KineoCore
import Testing

@Suite("Selection rules")
struct SelectionRulesTests {
    private struct LevelCase: Decodable, Sendable {
        let changeReport: ChangeReport
        let movementComfort: MovementComfort
        let lockedLevel: RoutineLevel
        let unlockedLevel: RoutineLevel
    }

    private struct LevelInput: Hashable {
        let changeReport: ChangeReport
        let movementComfort: MovementComfort
    }

    private struct ActiveHistoryFixtureCase: Decodable {
        let history: ActiveHistoryFixtureState
        let outcome: ActiveHistoryFixtureOutcome
        let expectedHistory: ActiveHistoryFixtureState?
        let expectedError: ActiveHistoryFixtureError?
    }

    private struct ActiveUnlockConfigurationFixture: Decodable {
        let qualifyingOutcomeCountRequired: Int
        let qualifyingLevels: [RoutineLevel]
        let qualifyingResponses: [AreaResponse]
    }

    private struct ActiveHistoryFixtureState: Decodable {
        let area: BodyArea
        let qualifyingOutcomeCount: Int
        let mostRecentRecordedResponse: AreaResponse?
    }

    private struct ActiveHistoryFixtureOutcome: Decodable {
        let area: BodyArea
        let routineStatus: RoutineStatus
        let deliveredLevel: RoutineLevel
        let response: AreaResponse?
        let wasIncludedInDeliveredRoutine: Bool
    }

    private enum ActiveHistoryFixtureError: String, Decodable {
        case areaMismatch
        case areaNotIncluded
        case nonterminalRoutine
        case qualifyingCountOverflow
    }

    @Test("Base mapping matches the shared parity fixture")
    private func baseMapping() throws {
        let fixtureURL = try #require(
            Bundle.module.url(
                forResource: "area-level-selection-v1",
                withExtension: "json"
            )
        )
        let fixtureData = try Data(contentsOf: fixtureURL)
        let levelCases = try JSONDecoder().decode([LevelCase].self, from: fixtureData)
        let expectedInputs = Set(
            ChangeReport.allCases.flatMap { changeReport in
                MovementComfort.allCases.map { movementComfort in
                    LevelInput(
                        changeReport: changeReport,
                        movementComfort: movementComfort
                    )
                }
            }
        )

        #expect(levelCases.count == expectedInputs.count)
        #expect(
            Set(
                levelCases.map {
                    LevelInput(
                        changeReport: $0.changeReport,
                        movementComfort: $0.movementComfort
                    )
                }
            ) == expectedInputs
        )

        for testCase in levelCases {
            #expect(
                AreaLevelRule.level(
                    changeReport: testCase.changeReport,
                    movementComfort: testCase.movementComfort,
                    activeUnlocked: false
                ) == testCase.lockedLevel
            )
            #expect(
                AreaLevelRule.level(
                    changeReport: testCase.changeReport,
                    movementComfort: testCase.movementComfort,
                    activeUnlocked: true
                ) == testCase.unlockedLevel
            )
        }
    }

    @Test("Swift matches the shared Active-history parity fixture")
    private func activeHistoryParity() throws {
        let configurationURL = try #require(
            Bundle.module.url(
                forResource: "active-unlock-configuration-v1",
                withExtension: "json"
            )
        )
        let configurationData = try Data(contentsOf: configurationURL)
        let configurationFixture = try JSONDecoder().decode(
            ActiveUnlockConfigurationFixture.self,
            from: configurationData
        )
        #expect(
            ActiveUnlockConfiguration.prototype.qualifyingOutcomeCountRequired ==
                configurationFixture.qualifyingOutcomeCountRequired
        )
        #expect(
            ActiveUnlockConfiguration.prototype.qualifyingLevels ==
                Set(configurationFixture.qualifyingLevels)
        )
        #expect(
            ActiveUnlockConfiguration.prototype.qualifyingResponses ==
                Set(configurationFixture.qualifyingResponses)
        )

        let fixtureURL = try #require(
            Bundle.module.url(
                forResource: "active-history-v1",
                withExtension: "json"
            )
        )
        let fixtureData = try Data(contentsOf: fixtureURL)
        let fixture = try JSONDecoder().decode(
            [ActiveHistoryFixtureCase].self,
            from: fixtureData
        )
        let historyReducer = ActiveHistoryReducer(configuration: .prototype)

        for testCase in fixture {
            let history = try historyState(from: testCase.history)
            let outcome = RoutineAreaOutcome(
                area: testCase.outcome.area,
                routineStatus: testCase.outcome.routineStatus,
                deliveredLevel: testCase.outcome.deliveredLevel,
                response: testCase.outcome.response,
                wasIncludedInDeliveredRoutine: testCase.outcome.wasIncludedInDeliveredRoutine
            )
            let expectedHistory = try testCase.expectedHistory.map(historyState)
            do {
                let result = try historyReducer.reducing(history, with: outcome)
                #expect(testCase.expectedError == nil)
                #expect(result == expectedHistory)
            } catch {
                #expect(testCase.expectedHistory == nil)
                #expect(activeHistoryFixtureError(from: error) == testCase.expectedError)
            }
        }
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

    @Test("Every terminal history outcome follows the frozen matrix")
    func exhaustiveTerminalOutcomeMatrix() throws {
        let terminalStatuses = [
            RoutineStatus.completed,
            RoutineStatus.stopped,
            RoutineStatus.safetyStopped,
            RoutineStatus.abandoned
        ]
        let responses: [AreaResponse?] = [nil, .better, .same, .worse]
        let startingCount = 1
        let qualifyingCount = startingCount + 1
        for status in terminalStatuses {
            for level in RoutineLevel.allCases {
                for response in responses {
                    let result = try reducer().reducing(
                        state(count: startingCount, latest: .same),
                        with: outcome(status: status, level: level, response: response)
                    )
                    let qualifies = status == .completed &&
                        (level == .gentle || level == .balanced) &&
                        (response == .better || response == .same)
                    let expectedCount = if response == .worse {
                        0
                    } else if qualifies {
                        qualifyingCount
                    } else {
                        startingCount
                    }
                    #expect(result.qualifyingOutcomeCount == expectedCount)
                    #expect(result.mostRecentRecordedResponse == (response ?? .same))
                }
            }
        }
    }

    @Test("Skipped and incomplete outcomes do not interrupt qualifying sequences")
    func qualifyingSequences() throws {
        let historyReducer = try reducer()
        let first = try historyReducer.reducing(
            state(),
            with: outcome(status: .completed, level: .gentle, response: .better)
        )
        let skipped = try historyReducer.reducing(
            first,
            with: outcome(status: .completed, level: .balanced, response: nil)
        )
        let incomplete = try historyReducer.reducing(
            skipped,
            with: outcome(status: .stopped, level: .balanced, response: .same)
        )
        let second = try historyReducer.reducing(
            incomplete,
            with: outcome(status: .completed, level: .balanced, response: .same)
        )
        let reset = try historyReducer.reducing(
            second,
            with: outcome(status: .abandoned, level: .active, response: .worse)
        )

        #expect(second.qualifyingOutcomeCount == PrototypeSelectionRules.qualifyingOutcomeCountRequired)
        #expect(reset.qualifyingOutcomeCount == 0)
        #expect(reset.mostRecentRecordedResponse == .worse)
    }

    private func reducer() throws -> ActiveHistoryReducer {
        ActiveHistoryReducer(configuration: try ActiveUnlockConfiguration())
    }

    private func historyState(
        from fixture: ActiveHistoryFixtureState
    ) throws -> ActiveHistoryState {
        try ActiveHistoryState(
            area: fixture.area,
            qualifyingOutcomeCount: fixture.qualifyingOutcomeCount,
            mostRecentRecordedResponse: fixture.mostRecentRecordedResponse
        )
    }

    private func activeHistoryFixtureError(
        from error: ActiveHistoryReductionError
    ) -> ActiveHistoryFixtureError {
        switch error {
        case .areaMismatch:
            .areaMismatch
        case .areaNotIncluded:
            .areaNotIncluded
        case .nonterminalRoutine:
            .nonterminalRoutine
        case .qualifyingCountOverflow:
            .qualifyingCountOverflow
        }
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
