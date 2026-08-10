public enum CheckInStatus: String, Codable, Sendable {
    case draft
    case completed
    case abandoned
}

public enum CheckInKind: String, Codable, Sendable {
    case normal
    case attentionCorrection
}

public struct CorrectionSource: Equatable, Sendable, Codable {
    public let area: BodyArea
    public let triggeringEntryID: CheckInEntryID?

    public init(area: BodyArea, triggeringEntryID: CheckInEntryID?) {
        self.area = area
        self.triggeringEntryID = triggeringEntryID
    }
}

public struct CheckInEntry: Equatable, Sendable, Codable {
    public let id: CheckInEntryID
    public let area: BodyArea
    public let role: AreaRole
    public let changeReport: ChangeReport
    public let movementComfort: MovementComfort
    public let conditionalSafetyAnswer: ConditionalSafetyAnswer?
    public let submittedAt: TimestampMilliseconds

    public var requiresConditionalSafetyAnswer: Bool {
        changeReport == .worse || movementComfort == .limited
    }

    public var triggersAttention: Bool {
        conditionalSafetyAnswer == .yes || conditionalSafetyAnswer == .notSure
    }

    public init(
        id: CheckInEntryID,
        area: BodyArea,
        role: AreaRole,
        changeReport: ChangeReport,
        movementComfort: MovementComfort,
        conditionalSafetyAnswer: ConditionalSafetyAnswer?,
        submittedAt: TimestampMilliseconds
    ) throws {
        let requiresAnswer = changeReport == .worse || movementComfort == .limited
        guard requiresAnswer == (conditionalSafetyAnswer != nil) else {
            throw DomainValidationError.invariantViolation(
                "A conditional answer must exist exactly when change is worse or comfort is limited."
            )
        }
        self.id = id
        self.area = area
        self.role = role
        self.changeReport = changeReport
        self.movementComfort = movementComfort
        self.conditionalSafetyAnswer = conditionalSafetyAnswer
        self.submittedAt = submittedAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(CheckInEntryID.self, forKey: .id),
            area: values.decode(BodyArea.self, forKey: .area),
            role: values.decode(AreaRole.self, forKey: .role),
            changeReport: values.decode(ChangeReport.self, forKey: .changeReport),
            movementComfort: values.decode(MovementComfort.self, forKey: .movementComfort),
            conditionalSafetyAnswer: values.decodeIfPresent(
                ConditionalSafetyAnswer.self,
                forKey: .conditionalSafetyAnswer
            ),
            submittedAt: values.decode(TimestampMilliseconds.self, forKey: .submittedAt)
        )
    }
}

public struct CheckIn: Equatable, Sendable, Codable {
    public let id: CheckInID
    public let status: CheckInStatus
    public let kind: CheckInKind
    public let correctionSource: CorrectionSource?
    public let primaryArea: BodyArea
    public let secondaryArea: BodyArea?
    public let startedAt: TimestampMilliseconds
    public let completedAt: TimestampMilliseconds?
    public let dayContext: LocalDayContext
    public let entries: [CheckInEntry]

    public init(
        id: CheckInID,
        status: CheckInStatus,
        kind: CheckInKind = .normal,
        correctionSource: CorrectionSource? = nil,
        primaryArea: BodyArea,
        secondaryArea: BodyArea?,
        startedAt: TimestampMilliseconds,
        completedAt: TimestampMilliseconds?,
        dayContext: LocalDayContext,
        entries: [CheckInEntry]
    ) throws {
        guard primaryArea != secondaryArea else {
            throw DomainValidationError.invariantViolation("Primary and secondary areas must differ.")
        }
        guard (kind == .normal) == (correctionSource == nil) else {
            throw DomainValidationError.invariantViolation(
                "Only an attention-correction check-in has a correction source."
            )
        }
        if let correctionSource {
            guard correctionSource.area == primaryArea || correctionSource.area == secondaryArea else {
                throw DomainValidationError.invariantViolation(
                    "The correction source area must belong to the fresh check-in."
                )
            }
        }
        guard Set(entries.map(\.id)).count == entries.count,
              Set(entries.map(\.area)).count == entries.count else {
            throw DomainValidationError.invariantViolation("Check-in entries must be unique.")
        }
        for entry in entries {
            let expectedRole: AreaRole?
            if entry.area == primaryArea {
                expectedRole = .primary
            } else if entry.area == secondaryArea {
                expectedRole = .secondary
            } else {
                expectedRole = nil
            }
            guard entry.role == expectedRole else {
                throw DomainValidationError.invariantViolation(
                    "Entry area and role must match the check-in area snapshot."
                )
            }
        }
        switch status {
        case .completed:
            guard completedAt != nil,
                  entries.contains(where: { $0.area == primaryArea && $0.role == .primary }) else {
                throw DomainValidationError.invariantViolation(
                    "A completed check-in requires a completion time and primary entry."
                )
            }
        case .draft, .abandoned:
            guard completedAt == nil else {
                throw DomainValidationError.invariantViolation(
                    "Only a completed check-in has a completion time."
                )
            }
        }
        if let completedAt {
            guard completedAt >= startedAt else {
                throw DomainValidationError.invariantViolation(
                    "Check-in completion cannot precede its start."
                )
            }
        }

        self.id = id
        self.status = status
        self.kind = kind
        self.correctionSource = correctionSource
        self.primaryArea = primaryArea
        self.secondaryArea = secondaryArea
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.dayContext = dayContext
        self.entries = entries
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(CheckInID.self, forKey: .id),
            status: values.decode(CheckInStatus.self, forKey: .status),
            kind: values.decode(CheckInKind.self, forKey: .kind),
            correctionSource: values.decodeIfPresent(CorrectionSource.self, forKey: .correctionSource),
            primaryArea: values.decode(BodyArea.self, forKey: .primaryArea),
            secondaryArea: values.decodeIfPresent(BodyArea.self, forKey: .secondaryArea),
            startedAt: values.decode(TimestampMilliseconds.self, forKey: .startedAt),
            completedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .completedAt),
            dayContext: values.decode(LocalDayContext.self, forKey: .dayContext),
            entries: values.decode([CheckInEntry].self, forKey: .entries)
        )
    }
}

public enum SafetyEventKind: String, Codable, Sendable {
    case attentionEntered
    case attentionClearedReturnedToUsual
    case attentionClearedCorrection
    case attentionReaffirmed
    case attentionReaffirmedCorrection
}

public struct AttentionState: Equatable, Sendable, Codable {
    public let area: BodyArea
    public let updatedAt: TimestampMilliseconds

    public init(area: BodyArea, updatedAt: TimestampMilliseconds) {
        self.area = area
        self.updatedAt = updatedAt
    }
}

public struct SafetyEvent: Equatable, Sendable, Codable {
    public let id: SafetyEventID
    public let area: BodyArea
    public let kind: SafetyEventKind
    public let sourceCheckInEntryID: CheckInEntryID?
    public let returnAnswer: ConditionalSafetyAnswer?
    public let occurredAt: TimestampMilliseconds
    public let dayContext: LocalDayContext

    public init(
        id: SafetyEventID,
        area: BodyArea,
        kind: SafetyEventKind,
        sourceCheckInEntryID: CheckInEntryID?,
        returnAnswer: ConditionalSafetyAnswer? = nil,
        occurredAt: TimestampMilliseconds,
        dayContext: LocalDayContext
    ) throws {
        switch kind {
        case .attentionEntered, .attentionClearedCorrection, .attentionReaffirmedCorrection:
            guard sourceCheckInEntryID != nil, returnAnswer == nil else {
                throw DomainValidationError.invariantViolation(
                    "Entry-sourced safety events require an entry and no return answer."
                )
            }
        case .attentionClearedReturnedToUsual:
            guard sourceCheckInEntryID == nil, returnAnswer == .yes else {
                throw DomainValidationError.invariantViolation(
                    "A return-to-usual clear event must preserve the Yes answer."
                )
            }
        case .attentionReaffirmed:
            guard sourceCheckInEntryID == nil,
                  returnAnswer == .no || returnAnswer == .notSure else {
                throw DomainValidationError.invariantViolation(
                    "A return reaffirmation must preserve No or Not sure."
                )
            }
        }
        self.id = id
        self.area = area
        self.kind = kind
        self.sourceCheckInEntryID = sourceCheckInEntryID
        self.returnAnswer = returnAnswer
        self.occurredAt = occurredAt
        self.dayContext = dayContext
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(SafetyEventID.self, forKey: .id),
            area: values.decode(BodyArea.self, forKey: .area),
            kind: values.decode(SafetyEventKind.self, forKey: .kind),
            sourceCheckInEntryID: values.decodeIfPresent(CheckInEntryID.self, forKey: .sourceCheckInEntryID),
            returnAnswer: values.decodeIfPresent(ConditionalSafetyAnswer.self, forKey: .returnAnswer),
            occurredAt: values.decode(TimestampMilliseconds.self, forKey: .occurredAt),
            dayContext: values.decode(LocalDayContext.self, forKey: .dayContext)
        )
    }
}

public struct SafetyMutation: Equatable, Sendable, Codable {
    public let event: SafetyEvent
    public let statusAfter: SafetyStatus
    public let expectedAttentionUpdatedAt: TimestampMilliseconds?

    public init(
        event: SafetyEvent,
        statusAfter: SafetyStatus,
        expectedAttentionUpdatedAt: TimestampMilliseconds? = nil
    ) throws {
        let expectedStatus: SafetyStatus
        switch event.kind {
        case .attentionClearedReturnedToUsual, .attentionClearedCorrection:
            expectedStatus = .normal
        case .attentionEntered, .attentionReaffirmed, .attentionReaffirmedCorrection:
            expectedStatus = .attentionRequired
        }
        guard statusAfter == expectedStatus else {
            throw DomainValidationError.invariantViolation(
                "Safety event and resulting status disagree."
            )
        }
        switch event.kind {
        case .attentionEntered:
            guard expectedAttentionUpdatedAt == nil else {
                throw DomainValidationError.invariantViolation(
                    "Entering Attention requires no prior Attention version."
                )
            }
        case .attentionClearedReturnedToUsual, .attentionClearedCorrection,
             .attentionReaffirmed, .attentionReaffirmedCorrection:
            guard let expectedAttentionUpdatedAt,
                  expectedAttentionUpdatedAt < event.occurredAt else {
                throw DomainValidationError.invariantViolation(
                    "Changing Attention requires the current version and a newer event time."
                )
            }
        }
        self.event = event
        self.statusAfter = statusAfter
        self.expectedAttentionUpdatedAt = expectedAttentionUpdatedAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            event: values.decode(SafetyEvent.self, forKey: .event),
            statusAfter: values.decode(SafetyStatus.self, forKey: .statusAfter),
            expectedAttentionUpdatedAt: values.decodeIfPresent(
                TimestampMilliseconds.self,
                forKey: .expectedAttentionUpdatedAt
            )
        )
    }
}

public struct PauseTodayEvent: Equatable, Sendable, Codable {
    public let id: PauseTodayEventID
    public let checkInID: CheckInID
    public let chosenAt: TimestampMilliseconds
    public let dayContext: LocalDayContext

    public init(
        id: PauseTodayEventID,
        checkInID: CheckInID,
        chosenAt: TimestampMilliseconds,
        dayContext: LocalDayContext
    ) {
        self.id = id
        self.checkInID = checkInID
        self.chosenAt = chosenAt
        self.dayContext = dayContext
    }
}
