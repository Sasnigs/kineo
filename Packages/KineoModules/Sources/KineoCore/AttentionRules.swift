/// A response from the persistent Attention return flow.
public enum AttentionReturnAnswer: String, Codable, Sendable {
    case returnedToUsual
    case notReturned
    case notSure
    case selectedByMistake
}

/// The next action after an Attention return response.
public enum AttentionReturnDirective: Equatable, Sendable {
    case clearAndRequireFreshCheckIn(area: BodyArea)
    case keepAndShowGuidance(area: BodyArea)
    case keepAndStartFreshCorrection(area: BodyArea)
}

/// The safety mutation implied by a submitted correction entry.
public enum AttentionCorrectionDirective: Equatable, Sendable {
    case clearAttention(area: BodyArea, sourceEntryID: CheckInEntryID)
    case reaffirmAttention(
        area: BodyArea,
        sourceEntryID: CheckInEntryID,
        answer: ConditionalSafetyAnswer
    )
}

/// Invalid inputs to an Attention reducer.
public enum AttentionReductionError: Error, Equatable, Sendable {
    case attentionNotRequired
    case areaMismatch
    case invalidEntryRevision
    case missingConditionalAnswer
    case unexpectedConditionalAnswer
}

/// Reduces Attention return and correction input without persistence side effects.
public enum AttentionReducer {
    private static let firstEntryRevision = 1

    /// Resolves a return response for one currently flagged area.
    public static func reduceReturn(
        for area: BodyArea,
        currentStatus: SafetyStatus,
        answer: AttentionReturnAnswer
    ) throws(AttentionReductionError) -> AttentionReturnDirective {
        guard currentStatus == .attentionRequired else { throw .attentionNotRequired }
        return switch answer {
        case .returnedToUsual:
            .clearAndRequireFreshCheckIn(area: area)
        case .notReturned, .notSure:
            .keepAndShowGuidance(area: area)
        case .selectedByMistake:
            .keepAndStartFreshCorrection(area: area)
        }
    }

    /// Resolves a fully submitted correction entry for one currently flagged area.
    public static func reduceCorrection(
        for area: BodyArea,
        currentStatus: SafetyStatus,
        correctedEntry: SelectionAreaCheckIn
    ) throws(AttentionReductionError) -> AttentionCorrectionDirective {
        guard currentStatus == .attentionRequired else { throw .attentionNotRequired }
        guard correctedEntry.area == area else { throw .areaMismatch }
        guard correctedEntry.entryRevision >= Self.firstEntryRevision else {
            throw .invalidEntryRevision
        }

        if correctedEntry.requiresConditionalSafetyAnswer {
            guard let answer = correctedEntry.conditionalSafetyAnswer else {
                throw .missingConditionalAnswer
            }
            switch answer {
            case .no:
                return .clearAttention(area: area, sourceEntryID: correctedEntry.checkInEntryID)
            case .yes, .notSure:
                return .reaffirmAttention(
                    area: area,
                    sourceEntryID: correctedEntry.checkInEntryID,
                    answer: answer
                )
            }
        }

        guard correctedEntry.conditionalSafetyAnswer == nil else {
            throw .unexpectedConditionalAnswer
        }
        return .clearAttention(area: area, sourceEntryID: correctedEntry.checkInEntryID)
    }
}
