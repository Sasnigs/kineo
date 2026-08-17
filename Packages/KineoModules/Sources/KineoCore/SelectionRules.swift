/// Versioned constants used by the prototype selection rules.
public enum PrototypeSelectionRules {
    /// The only rules version accepted by the prototype engine.
    public static let version = "selection-v1.0.0-prototype"

    /// The number of qualifying outcomes required to unlock Active for one area.
    public static let qualifyingOutcomeCountRequired = 2

    /// Stable ordering of every area supported by this rules version.
    public static let supportedAreas: [BodyArea] = [.neck, .upperMidBack, .lowerBack]
}

/// Configuration for area-specific Active eligibility.
public struct ActiveUnlockConfiguration: Equatable, Sendable {
    /// The immutable configuration for the current prototype rules version.
    public static let prototype = ActiveUnlockConfiguration(
        validatedQualifyingOutcomeCountRequired: PrototypeSelectionRules.qualifyingOutcomeCountRequired,
        qualifyingLevels: [.gentle, .balanced],
        qualifyingResponses: [.better, .same]
    )

    /// The number of qualifying outcomes required for an area.
    public let qualifyingOutcomeCountRequired: Int

    /// Levels whose completed outcomes may advance eligibility.
    public let qualifyingLevels: Set<RoutineLevel>

    /// Responses whose completed outcomes may advance eligibility.
    public let qualifyingResponses: Set<AreaResponse>

    /// Creates an Active-unlock configuration.
    ///
    /// - Throws: ``DomainValidationError/invalidRange(_:)`` when the required count is not positive.
    public init(
        qualifyingOutcomeCountRequired: Int = PrototypeSelectionRules.qualifyingOutcomeCountRequired,
        qualifyingLevels: Set<RoutineLevel> = [.gentle, .balanced],
        qualifyingResponses: Set<AreaResponse> = [.better, .same]
    ) throws {
        guard qualifyingOutcomeCountRequired > 0 else {
            throw DomainValidationError.invalidRange("qualifyingOutcomeCountRequired")
        }
        self.qualifyingOutcomeCountRequired = qualifyingOutcomeCountRequired
        self.qualifyingLevels = qualifyingLevels
        self.qualifyingResponses = qualifyingResponses
    }

    private init(
        validatedQualifyingOutcomeCountRequired: Int,
        qualifyingLevels: Set<RoutineLevel>,
        qualifyingResponses: Set<AreaResponse>
    ) {
        qualifyingOutcomeCountRequired = validatedQualifyingOutcomeCountRequired
        self.qualifyingLevels = qualifyingLevels
        self.qualifyingResponses = qualifyingResponses
    }
}

/// Frozen Active-eligibility history for one body area.
public struct ActiveHistoryState: Equatable, Sendable {
    /// The body area that owns this history.
    public let area: BodyArea

    /// The accumulated number of qualifying outcomes.
    public let qualifyingOutcomeCount: Int

    /// The latest explicit response, excluding skipped feedback.
    public let mostRecentRecordedResponse: AreaResponse?

    /// Creates a validated area history state.
    ///
    /// - Throws: ``DomainValidationError/invalidRange(_:)`` when the count is negative.
    public init(
        area: BodyArea,
        qualifyingOutcomeCount: Int,
        mostRecentRecordedResponse: AreaResponse?
    ) throws {
        guard qualifyingOutcomeCount >= 0 else {
            throw DomainValidationError.invalidRange("qualifyingOutcomeCount")
        }
        self.area = area
        self.qualifyingOutcomeCount = qualifyingOutcomeCount
        self.mostRecentRecordedResponse = mostRecentRecordedResponse
    }

    fileprivate init(
        validatedArea area: BodyArea,
        qualifyingOutcomeCount: Int,
        mostRecentRecordedResponse: AreaResponse?
    ) {
        self.area = area
        self.qualifyingOutcomeCount = qualifyingOutcomeCount
        self.mostRecentRecordedResponse = mostRecentRecordedResponse
    }

    /// Whether this area has met the configured Active threshold.
    public func isActiveUnlocked(using configuration: ActiveUnlockConfiguration) -> Bool {
        qualifyingOutcomeCount >= configuration.qualifyingOutcomeCountRequired
    }
}

/// A terminal routine outcome scoped to one delivered body area.
public struct RoutineAreaOutcome: Equatable, Sendable {
    /// The body area represented by the outcome.
    public let area: BodyArea

    /// The terminal routine status.
    public let routineStatus: RoutineStatus

    /// The level actually delivered after content fallback.
    public let deliveredLevel: RoutineLevel

    /// The user's optional response for this area.
    public let response: AreaResponse?

    /// Whether the area was present in the delivered routine.
    public let wasIncludedInDeliveredRoutine: Bool

    /// Creates a routine-area outcome.
    public init(
        area: BodyArea,
        routineStatus: RoutineStatus,
        deliveredLevel: RoutineLevel,
        response: AreaResponse?,
        wasIncludedInDeliveredRoutine: Bool
    ) {
        self.area = area
        self.routineStatus = routineStatus
        self.deliveredLevel = deliveredLevel
        self.response = response
        self.wasIncludedInDeliveredRoutine = wasIncludedInDeliveredRoutine
    }
}

/// Errors produced while reducing Active-eligibility history.
public enum ActiveHistoryReductionError: Error, Equatable, Sendable {
    /// The outcome belongs to a different area than the history.
    case areaMismatch

    /// The area was not delivered and therefore cannot affect its history.
    case areaNotIncluded

    /// Only terminal routine outcomes can update history.
    case nonterminalRoutine

    /// Incrementing the qualifying count would overflow.
    case qualifyingCountOverflow
}

/// Applies one terminal outcome to area-specific Active history.
public struct ActiveHistoryReducer: Sendable {
    private static let resetCount = 0
    private static let qualifyingIncrement = 1

    /// The rules used to determine whether an outcome qualifies.
    public let configuration: ActiveUnlockConfiguration

    /// Creates a history reducer.
    public init(configuration: ActiveUnlockConfiguration) {
        self.configuration = configuration
    }

    /// Returns history after applying one terminal area outcome.
    ///
    /// - Throws: ``ActiveHistoryReductionError`` when the event is inconsistent or cannot be represented.
    public func reducing(
        _ previous: ActiveHistoryState,
        with outcome: RoutineAreaOutcome
    ) throws(ActiveHistoryReductionError) -> ActiveHistoryState {
        guard previous.area == outcome.area else { throw .areaMismatch }
        guard outcome.wasIncludedInDeliveredRoutine else { throw .areaNotIncluded }
        guard outcome.routineStatus.isTerminal else { throw .nonterminalRoutine }

        if outcome.response == .worse {
            return ActiveHistoryState(
                validatedArea: previous.area,
                qualifyingOutcomeCount: Self.resetCount,
                mostRecentRecordedResponse: .worse
            )
        }

        let latestResponse = outcome.response ?? previous.mostRecentRecordedResponse
        let qualifies = outcome.routineStatus == .completed &&
            configuration.qualifyingLevels.contains(outcome.deliveredLevel) &&
            outcome.response.map(configuration.qualifyingResponses.contains) == true

        guard qualifies else {
            return ActiveHistoryState(
                validatedArea: previous.area,
                qualifyingOutcomeCount: previous.qualifyingOutcomeCount,
                mostRecentRecordedResponse: latestResponse
            )
        }

        let increment = previous.qualifyingOutcomeCount.addingReportingOverflow(Self.qualifyingIncrement)
        guard !increment.overflow else { throw .qualifyingCountOverflow }
        return ActiveHistoryState(
            validatedArea: previous.area,
            qualifyingOutcomeCount: increment.partialValue,
            mostRecentRecordedResponse: latestResponse
        )
    }
}

/// Computes the base routine level from one area's current answers.
public enum AreaLevelRule {
    /// Returns the area's base level after any required safety answer has been resolved as No.
    public static func level(
        changeReport: ChangeReport,
        movementComfort: MovementComfort,
        activeUnlocked: Bool
    ) -> RoutineLevel {
        if changeReport == .worse || movementComfort == .limited {
            return .gentle
        }
        if changeReport == .better && movementComfort == .good && activeUnlocked {
            return .active
        }
        return .balanced
    }
}
