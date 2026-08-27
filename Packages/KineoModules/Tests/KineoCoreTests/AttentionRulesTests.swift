import Foundation
import KineoCore
import Testing

@Suite("Attention rules")
struct AttentionRulesTests {
    private static let validRevision = 1

    private struct ParityFixture: Decodable {
        let returnCases: [ReturnCase]
        let correctionCases: [CorrectionCase]
    }

    private struct ReturnCase: Decodable {
        let area: BodyArea
        let currentStatus: SafetyStatus
        let answer: AttentionReturnAnswer
        let expectedDirective: ReturnDirectiveKind?
        let expectedError: FixtureError?
    }

    private struct CorrectionCase: Decodable {
        let area: BodyArea
        let currentStatus: SafetyStatus
        let entry: CorrectionEntry
        let expectedDirective: CorrectionDirectiveKind?
        let expectedError: FixtureError?
    }

    private struct CorrectionEntry: Decodable {
        let checkInEntryID: String
        let entryRevision: Int
        let area: BodyArea
        let changeReport: ChangeReport
        let movementComfort: MovementComfort
        let conditionalSafetyAnswer: ConditionalSafetyAnswer?
    }

    private enum ReturnDirectiveKind: String, Decodable {
        case clearAndRequireFreshCheckIn
        case keepAndShowGuidance
        case keepAndStartFreshCorrection
    }

    private enum CorrectionDirectiveKind: String, Decodable {
        case clearAttention
        case reaffirmAttention
    }

    private enum FixtureError: String, Decodable {
        case attentionNotRequired
        case areaMismatch
        case invalidEntryRevision
        case missingConditionalAnswer
        case unexpectedConditionalAnswer
    }

    @Test("Swift matches the shared Attention parity fixture")
    private func sharedParityFixture() throws {
        let fixtureURL = try #require(
            Bundle.module.url(
                forResource: "attention-reducer-v1",
                withExtension: "json"
            )
        )
        let fixtureData = try Data(contentsOf: fixtureURL)
        let fixture = try JSONDecoder().decode(ParityFixture.self, from: fixtureData)

        #expect(Set(fixture.returnCases.map(\.answer)) == Set(AttentionReturnAnswer.allCases))

        for testCase in fixture.returnCases {
            do {
                let directive = try AttentionReducer.reduceReturn(
                    for: testCase.area,
                    currentStatus: testCase.currentStatus,
                    answer: testCase.answer
                )
                #expect(testCase.expectedError == nil)
                #expect(returnKind(of: directive) == testCase.expectedDirective)
            } catch {
                #expect(testCase.expectedDirective == nil)
                #expect(fixtureError(from: error) == testCase.expectedError)
            }
        }

        for testCase in fixture.correctionCases {
            let entry = SelectionAreaCheckIn(
                checkInEntryID: try CheckInEntryID(validating: testCase.entry.checkInEntryID),
                entryRevision: testCase.entry.entryRevision,
                area: testCase.entry.area,
                changeReport: testCase.entry.changeReport,
                movementComfort: testCase.entry.movementComfort,
                conditionalSafetyAnswer: testCase.entry.conditionalSafetyAnswer
            )
            do {
                let directive = try AttentionReducer.reduceCorrection(
                    for: testCase.area,
                    currentStatus: testCase.currentStatus,
                    correctedEntry: entry
                )
                #expect(testCase.expectedError == nil)
                #expect(correctionKind(of: directive) == testCase.expectedDirective)
                switch directive {
                case let .clearAttention(area, sourceEntryID):
                    #expect(area == testCase.area)
                    #expect(sourceEntryID == entry.checkInEntryID)
                case let .reaffirmAttention(area, sourceEntryID, answer):
                    #expect(area == testCase.area)
                    #expect(sourceEntryID == entry.checkInEntryID)
                    #expect(answer == entry.conditionalSafetyAnswer)
                }
            } catch {
                #expect(testCase.expectedDirective == nil)
                #expect(fixtureError(from: error) == testCase.expectedError)
            }
        }
    }

    @Test("Return answers preserve or clear only the named area")
    private func returnAnswers() throws {
        #expect(
            try AttentionReducer.reduceReturn(
                for: .neck,
                currentStatus: .attentionRequired,
                answer: .returnedToUsual
            ) == .clearAndRequireFreshCheckIn(area: .neck)
        )
        #expect(
            try AttentionReducer.reduceReturn(
                for: .upperMidBack,
                currentStatus: .attentionRequired,
                answer: .notReturned
            ) == .keepAndShowGuidance(area: .upperMidBack)
        )
        #expect(
            try AttentionReducer.reduceReturn(
                for: .lowerBack,
                currentStatus: .attentionRequired,
                answer: .notSure
            ) == .keepAndShowGuidance(area: .lowerBack)
        )
        #expect(
            try AttentionReducer.reduceReturn(
                for: .neck,
                currentStatus: .attentionRequired,
                answer: .selectedByMistake
            ) == .keepAndStartFreshCorrection(area: .neck)
        )
    }

    @Test("Return flow rejects an unflagged area")
    private func returnRequiresAttention() {
        #expect(throws: AttentionReductionError.attentionNotRequired) {
            try AttentionReducer.reduceReturn(
                for: .neck,
                currentStatus: .normal,
                answer: .returnedToUsual
            )
        }
    }

    @Test("Valid correction entries clear Attention", arguments: [
        (ChangeReport.similar, MovementComfort.good, Optional<ConditionalSafetyAnswer>.none),
        (ChangeReport.worse, MovementComfort.good, Optional(ConditionalSafetyAnswer.no)),
        (ChangeReport.similar, MovementComfort.limited, Optional(ConditionalSafetyAnswer.no))
    ])
    private func validCorrectionClears(
        change: ChangeReport,
        comfort: MovementComfort,
        answer: ConditionalSafetyAnswer?
    ) throws {
        let entry = try checkIn(change: change, comfort: comfort, answer: answer)
        let result = try AttentionReducer.reduceCorrection(
            for: .neck,
            currentStatus: .attentionRequired,
            correctedEntry: entry
        )
        #expect(result == .clearAttention(area: .neck, sourceEntryID: entry.checkInEntryID))
    }

    @Test("Triggering correction answers reaffirm Attention", arguments: [
        ConditionalSafetyAnswer.yes,
        ConditionalSafetyAnswer.notSure
    ])
    private func correctionReaffirms(answer: ConditionalSafetyAnswer) throws {
        let entry = try checkIn(change: .worse, comfort: .good, answer: answer)
        let result = try AttentionReducer.reduceCorrection(
            for: .neck,
            currentStatus: .attentionRequired,
            correctedEntry: entry
        )
        #expect(
            result == .reaffirmAttention(
                area: .neck,
                sourceEntryID: entry.checkInEntryID,
                answer: answer
            )
        )
    }

    @Test("Invalid correction submissions fail explicitly")
    private func invalidCorrectionSubmissions() throws {
        let valid = try checkIn(change: .similar, comfort: .good, answer: nil)
        #expect(throws: AttentionReductionError.attentionNotRequired) {
            try AttentionReducer.reduceCorrection(
                for: .neck,
                currentStatus: .normal,
                correctedEntry: valid
            )
        }
        #expect(throws: AttentionReductionError.areaMismatch) {
            try AttentionReducer.reduceCorrection(
                for: .lowerBack,
                currentStatus: .attentionRequired,
                correctedEntry: valid
            )
        }
        #expect(throws: AttentionReductionError.invalidEntryRevision) {
            try AttentionReducer.reduceCorrection(
                for: .neck,
                currentStatus: .attentionRequired,
                correctedEntry: try checkIn(
                    revision: 0,
                    change: .similar,
                    comfort: .good,
                    answer: nil
                )
            )
        }
        #expect(throws: AttentionReductionError.missingConditionalAnswer) {
            try AttentionReducer.reduceCorrection(
                for: .neck,
                currentStatus: .attentionRequired,
                correctedEntry: try checkIn(
                    change: .worse,
                    comfort: .good,
                    answer: nil
                )
            )
        }
        #expect(throws: AttentionReductionError.unexpectedConditionalAnswer) {
            try AttentionReducer.reduceCorrection(
                for: .neck,
                currentStatus: .attentionRequired,
                correctedEntry: try checkIn(
                    change: .similar,
                    comfort: .good,
                    answer: .yes
                )
            )
        }
    }

    private func checkIn(
        revision: Int = Self.validRevision,
        change: ChangeReport,
        comfort: MovementComfort,
        answer: ConditionalSafetyAnswer?
    ) throws -> SelectionAreaCheckIn {
        SelectionAreaCheckIn(
            checkInEntryID: try CheckInEntryID(
                validating: "00000000-0000-0000-0000-000000000005"
            ),
            entryRevision: revision,
            area: .neck,
            changeReport: change,
            movementComfort: comfort,
            conditionalSafetyAnswer: answer
        )
    }

    private func returnKind(of directive: AttentionReturnDirective) -> ReturnDirectiveKind {
        switch directive {
        case .clearAndRequireFreshCheckIn:
            .clearAndRequireFreshCheckIn
        case .keepAndShowGuidance:
            .keepAndShowGuidance
        case .keepAndStartFreshCorrection:
            .keepAndStartFreshCorrection
        }
    }

    private func correctionKind(
        of directive: AttentionCorrectionDirective
    ) -> CorrectionDirectiveKind {
        switch directive {
        case .clearAttention:
            .clearAttention
        case .reaffirmAttention:
            .reaffirmAttention
        }
    }

    private func fixtureError(from error: AttentionReductionError) -> FixtureError {
        switch error {
        case .attentionNotRequired:
            .attentionNotRequired
        case .areaMismatch:
            .areaMismatch
        case .invalidEntryRevision:
            .invalidEntryRevision
        case .missingConditionalAnswer:
            .missingConditionalAnswer
        case .unexpectedConditionalAnswer:
            .unexpectedConditionalAnswer
        }
    }
}
