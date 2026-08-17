import KineoCore
import Testing

@Suite("Attention rules")
struct AttentionRulesTests {
    private static let validRevision = 1

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
}
