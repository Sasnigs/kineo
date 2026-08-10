public enum TelemetryChoice: String, Codable, Sendable {
    case notOffered
    case declined
    case optedIn
}

public struct UserProfile: Equatable, Sendable, Codable {
    public static let minimumWeeklyGoalDays = 1
    public static let maximumWeeklyGoalDays = 7
    public static let defaultWeeklyGoalDays = 3

    public let onboardingCompletedAt: TimestampMilliseconds?
    public let adultAcknowledged: Bool
    public let safetyBoundaryVersion: NonEmptyString?
    public let safetyAcknowledgedAt: TimestampMilliseconds?
    public let primaryArea: BodyArea?
    public let secondaryArea: BodyArea?
    public let routinePreference: NonEmptyString?
    public let weeklyGoalDays: Int
    public let telemetryChoice: TelemetryChoice
    public let createdAt: TimestampMilliseconds
    public let updatedAt: TimestampMilliseconds

    public init(
        onboardingCompletedAt: TimestampMilliseconds?,
        adultAcknowledged: Bool,
        safetyBoundaryVersion: NonEmptyString?,
        safetyAcknowledgedAt: TimestampMilliseconds?,
        primaryArea: BodyArea?,
        secondaryArea: BodyArea?,
        routinePreference: NonEmptyString?,
        weeklyGoalDays: Int = UserProfile.defaultWeeklyGoalDays,
        telemetryChoice: TelemetryChoice = .notOffered,
        createdAt: TimestampMilliseconds,
        updatedAt: TimestampMilliseconds
    ) throws {
        guard (Self.minimumWeeklyGoalDays...Self.maximumWeeklyGoalDays).contains(weeklyGoalDays) else {
            throw DomainValidationError.invalidRange("weeklyGoalDays")
        }
        guard primaryArea == nil || primaryArea != secondaryArea else {
            throw DomainValidationError.invariantViolation("Primary and secondary areas must differ.")
        }
        guard updatedAt >= createdAt else {
            throw DomainValidationError.invariantViolation("updatedAt cannot precede createdAt.")
        }
        if onboardingCompletedAt != nil {
            guard adultAcknowledged,
                  safetyBoundaryVersion != nil,
                  safetyAcknowledgedAt != nil,
                  primaryArea != nil else {
                throw DomainValidationError.invariantViolation(
                    "Completed onboarding requires adult and safety acknowledgements and a primary area."
                )
            }
        }

        self.onboardingCompletedAt = onboardingCompletedAt
        self.adultAcknowledged = adultAcknowledged
        self.safetyBoundaryVersion = safetyBoundaryVersion
        self.safetyAcknowledgedAt = safetyAcknowledgedAt
        self.primaryArea = primaryArea
        self.secondaryArea = secondaryArea
        self.routinePreference = routinePreference
        self.weeklyGoalDays = weeklyGoalDays
        self.telemetryChoice = telemetryChoice
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            onboardingCompletedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .onboardingCompletedAt),
            adultAcknowledged: values.decode(Bool.self, forKey: .adultAcknowledged),
            safetyBoundaryVersion: values.decodeIfPresent(NonEmptyString.self, forKey: .safetyBoundaryVersion),
            safetyAcknowledgedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .safetyAcknowledgedAt),
            primaryArea: values.decodeIfPresent(BodyArea.self, forKey: .primaryArea),
            secondaryArea: values.decodeIfPresent(BodyArea.self, forKey: .secondaryArea),
            routinePreference: values.decodeIfPresent(NonEmptyString.self, forKey: .routinePreference),
            weeklyGoalDays: values.decode(Int.self, forKey: .weeklyGoalDays),
            telemetryChoice: values.decode(TelemetryChoice.self, forKey: .telemetryChoice),
            createdAt: values.decode(TimestampMilliseconds.self, forKey: .createdAt),
            updatedAt: values.decode(TimestampMilliseconds.self, forKey: .updatedAt)
        )
    }
}

public struct ReminderWindow: Equatable, Sendable, Codable {
    public static let firstStartMinute = 0
    public static let lastStartMinute = 1_439
    public static let firstEndMinute = 1
    public static let endOfDayMinute = 1_440

    public let startMinutes: Int
    public let endMinutes: Int

    public init(startMinutes: Int, endMinutes: Int) throws {
        guard (Self.firstStartMinute...Self.lastStartMinute).contains(startMinutes),
              (Self.firstEndMinute...Self.endOfDayMinute).contains(endMinutes),
              endMinutes > startMinutes else {
            throw DomainValidationError.invalidRange("reminderWindow")
        }
        self.startMinutes = startMinutes
        self.endMinutes = endMinutes
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            startMinutes: values.decode(Int.self, forKey: .startMinutes),
            endMinutes: values.decode(Int.self, forKey: .endMinutes)
        )
    }
}

public struct ReminderSettings: Equatable, Sendable, Codable {
    public let enabled: Bool
    public let window: ReminderWindow?
    public let timeZoneID: NonEmptyString?
    public let updatedAt: TimestampMilliseconds

    public init(
        enabled: Bool,
        window: ReminderWindow?,
        timeZoneID: NonEmptyString?,
        updatedAt: TimestampMilliseconds
    ) throws {
        guard !enabled || window != nil else {
            throw DomainValidationError.invariantViolation("Enabled reminders require a window.")
        }
        self.enabled = enabled
        self.window = window
        self.timeZoneID = timeZoneID
        self.updatedAt = updatedAt
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            enabled: values.decode(Bool.self, forKey: .enabled),
            window: values.decodeIfPresent(ReminderWindow.self, forKey: .window),
            timeZoneID: values.decodeIfPresent(NonEmptyString.self, forKey: .timeZoneID),
            updatedAt: values.decode(TimestampMilliseconds.self, forKey: .updatedAt)
        )
    }
}
