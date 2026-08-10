import Foundation

public struct OpaqueRoutineSnapshot: Equatable, Sendable, Codable {
    public let bytes: Data
    public let checksum: SHA256Digest
    public let includedAreas: [BodyArea]

    public init(bytes: Data, checksum: SHA256Digest, includedAreas: [BodyArea]) throws {
        guard !bytes.isEmpty else {
            throw DomainValidationError.emptyValue("routineSnapshot")
        }
        guard (BodyAreaSelectionLimits.minimumCount...BodyAreaSelectionLimits.maximumCount)
            .contains(includedAreas.count),
              Set(includedAreas).count == includedAreas.count else {
            throw DomainValidationError.invariantViolation(
                "A routine snapshot must contain one or two distinct areas."
            )
        }
        self.bytes = bytes
        self.checksum = checksum
        self.includedAreas = includedAreas
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            bytes: values.decode(Data.self, forKey: .bytes),
            checksum: values.decode(SHA256Digest.self, forKey: .checksum),
            includedAreas: values.decode([BodyArea].self, forKey: .includedAreas)
        )
    }
}

public struct RoutineSession: Equatable, Sendable, Codable {
    public let id: RoutineSessionID
    public let decisionID: SelectionDecisionID
    public let checkInID: CheckInID
    public let status: RoutineStatus
    public let snapshot: OpaqueRoutineSnapshot
    public let currentStepIndex: Int
    public let stepElapsedMilliseconds: Int64
    public let startedAt: TimestampMilliseconds?
    public let updatedAt: TimestampMilliseconds
    public let endedAt: TimestampMilliseconds?
    public let dayContext: LocalDayContext

    public init(
        id: RoutineSessionID,
        decisionID: SelectionDecisionID,
        checkInID: CheckInID,
        status: RoutineStatus,
        snapshot: OpaqueRoutineSnapshot,
        currentStepIndex: Int,
        stepElapsedMilliseconds: Int64,
        startedAt: TimestampMilliseconds?,
        updatedAt: TimestampMilliseconds,
        endedAt: TimestampMilliseconds?,
        dayContext: LocalDayContext
    ) throws {
        guard currentStepIndex >= 0, stepElapsedMilliseconds >= 0 else {
            throw DomainValidationError.invalidRange("routineCheckpoint")
        }
        switch status {
        case .prepared:
            guard startedAt == nil, endedAt == nil else {
                throw DomainValidationError.invariantViolation("A prepared session has not started or ended.")
            }
        case .inProgress, .paused:
            guard startedAt != nil, endedAt == nil else {
                throw DomainValidationError.invariantViolation("An active session requires a start and no end.")
            }
        case .completed, .stopped, .safetyStopped:
            guard startedAt != nil, endedAt != nil else {
                throw DomainValidationError.invariantViolation("A terminal started session requires start and end times.")
            }
        case .abandoned:
            guard endedAt != nil else {
                throw DomainValidationError.invariantViolation("An abandoned session requires an end time.")
            }
        }
        if let startedAt {
            guard updatedAt >= startedAt else {
                throw DomainValidationError.invariantViolation("Session update cannot precede its start.")
            }
        }
        if let endedAt {
            guard endedAt <= updatedAt else {
                throw DomainValidationError.invariantViolation("Session timestamps are not chronological.")
            }
            if let startedAt, endedAt < startedAt {
                throw DomainValidationError.invariantViolation("Session timestamps are not chronological.")
            }
        }

        self.id = id
        self.decisionID = decisionID
        self.checkInID = checkInID
        self.status = status
        self.snapshot = snapshot
        self.currentStepIndex = currentStepIndex
        self.stepElapsedMilliseconds = stepElapsedMilliseconds
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.endedAt = endedAt
        self.dayContext = dayContext
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(RoutineSessionID.self, forKey: .id),
            decisionID: values.decode(SelectionDecisionID.self, forKey: .decisionID),
            checkInID: values.decode(CheckInID.self, forKey: .checkInID),
            status: values.decode(RoutineStatus.self, forKey: .status),
            snapshot: values.decode(OpaqueRoutineSnapshot.self, forKey: .snapshot),
            currentStepIndex: values.decode(Int.self, forKey: .currentStepIndex),
            stepElapsedMilliseconds: values.decode(Int64.self, forKey: .stepElapsedMilliseconds),
            startedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .startedAt),
            updatedAt: values.decode(TimestampMilliseconds.self, forKey: .updatedAt),
            endedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .endedAt),
            dayContext: values.decode(LocalDayContext.self, forKey: .dayContext)
        )
    }
}

public enum RoutineEventKind: String, Codable, Sendable {
    case started
    case paused
    case resumed
    case stepCompleted
    case skipped
    case alternativeSelected
    case stopped
    case safetyStopped
    case completed
    case abandoned
}

public enum RoutineEventReason: String, Codable, Sendable {
    case uncomfortable
    case unclear
    case notEnoughSpace
}

public struct RoutineEvent: Equatable, Sendable, Codable {
    public let id: RoutineEventID
    public let routineSessionID: RoutineSessionID
    public let sequenceNumber: Int
    public let kind: RoutineEventKind
    public let stepID: NonEmptyString?
    public let moduleID: NonEmptyString?
    public let alternativeID: NonEmptyString?
    public let localReason: RoutineEventReason?
    public let occurredAt: TimestampMilliseconds

    public init(
        id: RoutineEventID,
        routineSessionID: RoutineSessionID,
        sequenceNumber: Int,
        kind: RoutineEventKind,
        stepID: NonEmptyString?,
        moduleID: NonEmptyString?,
        alternativeID: NonEmptyString?,
        localReason: RoutineEventReason?,
        occurredAt: TimestampMilliseconds
    ) throws {
        guard sequenceNumber >= 1 else {
            throw DomainValidationError.invalidRange("routineEventSequence")
        }
        let hasStep = stepID != nil && moduleID != nil
        guard (stepID == nil) == (moduleID == nil) else {
            throw DomainValidationError.invariantViolation("Step and module identifiers must appear together.")
        }
        switch kind {
        case .stepCompleted:
            guard hasStep, alternativeID == nil, localReason == nil else {
                throw DomainValidationError.invariantViolation("Step-completed event fields are inconsistent.")
            }
        case .skipped:
            guard hasStep, alternativeID == nil else {
                throw DomainValidationError.invariantViolation("Skipped event fields are inconsistent.")
            }
        case .alternativeSelected:
            guard hasStep, alternativeID != nil, localReason == nil else {
                throw DomainValidationError.invariantViolation("Alternative event fields are inconsistent.")
            }
        case .started, .paused, .resumed, .stopped, .safetyStopped, .completed, .abandoned:
            guard !hasStep, alternativeID == nil, localReason == nil else {
                throw DomainValidationError.invariantViolation("Lifecycle events cannot contain movement fields.")
            }
        }
        self.id = id
        self.routineSessionID = routineSessionID
        self.sequenceNumber = sequenceNumber
        self.kind = kind
        self.stepID = stepID
        self.moduleID = moduleID
        self.alternativeID = alternativeID
        self.localReason = localReason
        self.occurredAt = occurredAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(RoutineEventID.self, forKey: .id),
            routineSessionID: values.decode(RoutineSessionID.self, forKey: .routineSessionID),
            sequenceNumber: values.decode(Int.self, forKey: .sequenceNumber),
            kind: values.decode(RoutineEventKind.self, forKey: .kind),
            stepID: values.decodeIfPresent(NonEmptyString.self, forKey: .stepID),
            moduleID: values.decodeIfPresent(NonEmptyString.self, forKey: .moduleID),
            alternativeID: values.decodeIfPresent(NonEmptyString.self, forKey: .alternativeID),
            localReason: values.decodeIfPresent(RoutineEventReason.self, forKey: .localReason),
            occurredAt: values.decode(TimestampMilliseconds.self, forKey: .occurredAt)
        )
    }
}

public struct RoutineCheckpoint: Equatable, Sendable, Codable {
    public let status: RoutineStatus
    public let currentStepIndex: Int
    public let stepElapsedMilliseconds: Int64
    public let updatedAt: TimestampMilliseconds
    public let endedAt: TimestampMilliseconds?

    public init(
        status: RoutineStatus,
        currentStepIndex: Int,
        stepElapsedMilliseconds: Int64,
        updatedAt: TimestampMilliseconds,
        endedAt: TimestampMilliseconds?
    ) throws {
        guard currentStepIndex >= 0, stepElapsedMilliseconds >= 0 else {
            throw DomainValidationError.invalidRange("routineCheckpoint")
        }
        guard status.isTerminal == (endedAt != nil) else {
            throw DomainValidationError.invariantViolation("Only a terminal checkpoint has an end time.")
        }
        if let endedAt {
            guard endedAt <= updatedAt else {
                throw DomainValidationError.invariantViolation(
                    "A checkpoint cannot end after its update time."
                )
            }
        }
        self.status = status
        self.currentStepIndex = currentStepIndex
        self.stepElapsedMilliseconds = stepElapsedMilliseconds
        self.updatedAt = updatedAt
        self.endedAt = endedAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            status: values.decode(RoutineStatus.self, forKey: .status),
            currentStepIndex: values.decode(Int.self, forKey: .currentStepIndex),
            stepElapsedMilliseconds: values.decode(Int64.self, forKey: .stepElapsedMilliseconds),
            updatedAt: values.decode(TimestampMilliseconds.self, forKey: .updatedAt),
            endedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .endedAt)
        )
    }
}

public struct FeedbackResponse: Equatable, Sendable, Codable {
    public let id: AreaFeedbackID
    public let area: BodyArea
    public let response: AreaResponse

    public init(id: AreaFeedbackID, area: BodyArea, response: AreaResponse) {
        self.id = id
        self.area = area
        self.response = response
    }
}

public struct FeedbackSubmission: Equatable, Sendable, Codable {
    public let id: FeedbackSubmissionID
    public let routineSessionID: RoutineSessionID
    public let responses: [FeedbackResponse]
    public let submittedAt: TimestampMilliseconds
    public let dayContext: LocalDayContext

    public init(
        id: FeedbackSubmissionID,
        routineSessionID: RoutineSessionID,
        responses: [FeedbackResponse],
        submittedAt: TimestampMilliseconds,
        dayContext: LocalDayContext
    ) throws {
        guard Set(responses.map(\.id)).count == responses.count,
              Set(responses.map(\.area)).count == responses.count else {
            throw DomainValidationError.invariantViolation("Feedback responses must be unique by ID and area.")
        }
        self.id = id
        self.routineSessionID = routineSessionID
        self.responses = responses
        self.submittedAt = submittedAt
        self.dayContext = dayContext
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(FeedbackSubmissionID.self, forKey: .id),
            routineSessionID: values.decode(RoutineSessionID.self, forKey: .routineSessionID),
            responses: values.decode([FeedbackResponse].self, forKey: .responses),
            submittedAt: values.decode(TimestampMilliseconds.self, forKey: .submittedAt),
            dayContext: values.decode(LocalDayContext.self, forKey: .dayContext)
        )
    }
}
