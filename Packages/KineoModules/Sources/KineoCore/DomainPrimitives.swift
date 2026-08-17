import Foundation

public enum DomainValidationError: Error, Equatable, Sendable {
    case emptyValue(String)
    case invalidIdentifier(String)
    case invalidLocalDay(String)
    case invalidDigest(String)
    case invalidRange(String)
    case invariantViolation(String)
}

public struct StableID<Kind>: Hashable, Sendable, Codable, RawRepresentable {
    public let rawValue: String

    public init?(rawValue: String) {
        guard Self.isCanonicalUUID(rawValue) else { return nil }
        self.rawValue = rawValue
    }

    public init(validating rawValue: String) throws {
        guard Self.isCanonicalUUID(rawValue) else {
            throw DomainValidationError.invalidIdentifier(rawValue)
        }
        self.rawValue = rawValue
    }

    public init(_ uuid: UUID) {
        rawValue = uuid.uuidString.lowercased()
    }

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        guard Self.isCanonicalUUID(value) else {
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Expected a lower-case canonical UUID."
            )
        }
        rawValue = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private static func isCanonicalUUID(_ value: String) -> Bool {
        guard let uuid = UUID(uuidString: value) else { return false }
        return uuid.uuidString.lowercased() == value
    }
}

public enum CheckInIdentity {}
public enum CheckInEntryIdentity {}
public enum SafetyEventIdentity {}
public enum SelectionDecisionIdentity {}
public enum RoutineSessionIdentity {}
public enum RoutineEventIdentity {}
public enum PauseTodayEventIdentity {}
public enum FeedbackSubmissionIdentity {}
public enum AreaFeedbackIdentity {}

public typealias CheckInID = StableID<CheckInIdentity>
public typealias CheckInEntryID = StableID<CheckInEntryIdentity>
public typealias SafetyEventID = StableID<SafetyEventIdentity>
public typealias SelectionDecisionID = StableID<SelectionDecisionIdentity>
public typealias RoutineSessionID = StableID<RoutineSessionIdentity>
public typealias RoutineEventID = StableID<RoutineEventIdentity>
public typealias PauseTodayEventID = StableID<PauseTodayEventIdentity>
public typealias FeedbackSubmissionID = StableID<FeedbackSubmissionIdentity>
public typealias AreaFeedbackID = StableID<AreaFeedbackIdentity>

public struct NonEmptyString: Hashable, Sendable, Codable, RawRepresentable {
    public let rawValue: String

    public init?(rawValue: String) {
        guard !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        self.rawValue = rawValue
    }

    public init(validating rawValue: String, field: String = "value") throws {
        guard !rawValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DomainValidationError.emptyValue(field)
        }
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a non-empty string."
            )
        }
        rawValue = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct TimestampMilliseconds: Hashable, Comparable, Sendable, Codable, RawRepresentable {
    public let rawValue: Int64

    public init(rawValue: Int64) {
        self.rawValue = rawValue
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

public struct LocalDay: Hashable, Sendable, Codable, RawRepresentable {
    public static let encodedLength = 10

    private static let yearLength = 4
    private static let monthLength = 2
    private static let dayLength = 2
    private static let firstSeparatorIndex = 4
    private static let secondSeparatorIndex = 7
    private static let monthStartIndex = 5
    private static let separatorByte: UInt8 = 45
    private static let decimalDigitByteRange: ClosedRange<UInt8> = 48...57
    private static let utcOffsetSeconds = 0

    public let rawValue: String

    public init?(rawValue: String) {
        guard Self.hasRequiredShape(rawValue) else { return nil }
        self.rawValue = rawValue
    }

    public init(validating rawValue: String) throws {
        guard Self.hasRequiredShape(rawValue) else {
            throw DomainValidationError.invalidLocalDay(rawValue)
        }
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        guard Self.hasRequiredShape(value) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected YYYY-MM-DD."
            )
        }
        rawValue = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private static func hasRequiredShape(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count == encodedLength,
              bytes[firstSeparatorIndex] == separatorByte,
              bytes[secondSeparatorIndex] == separatorByte else { return false }
        guard bytes.enumerated().allSatisfy({ index, byte in
            index == firstSeparatorIndex ||
                index == secondSeparatorIndex ||
                decimalDigitByteRange.contains(byte)
        }) else { return false }

        guard let year = Int(value.prefix(yearLength)),
              let month = Int(value.dropFirst(monthStartIndex).prefix(monthLength)),
              let day = Int(value.suffix(dayLength)),
              year > 0 else { return false }
        var calendar = Calendar(identifier: .gregorian)
        guard let utcTimeZone = TimeZone(secondsFromGMT: utcOffsetSeconds) else { return false }
        calendar.timeZone = utcTimeZone
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else {
            return false
        }
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return components.year == year && components.month == month && components.day == day
    }
}

public struct LocalDayContext: Hashable, Sendable, Codable {
    public let localDay: LocalDay
    public let timeZoneID: NonEmptyString
    public let calendarID: NonEmptyString

    public init(localDay: LocalDay, timeZoneID: NonEmptyString, calendarID: NonEmptyString) {
        self.localDay = localDay
        self.timeZoneID = timeZoneID
        self.calendarID = calendarID
    }
}

public struct SHA256Digest: Hashable, Sendable, Codable, RawRepresentable {
    public static let encodedLength = 64

    private static let decimalDigitByteRange: ClosedRange<UInt8> = 48...57
    private static let lowerHexLetterByteRange: ClosedRange<UInt8> = 97...102

    public let rawValue: String

    public init?(rawValue: String) {
        guard Self.isValid(rawValue) else { return nil }
        self.rawValue = rawValue
    }

    public init(validating rawValue: String) throws {
        guard Self.isValid(rawValue) else {
            throw DomainValidationError.invalidDigest(rawValue)
        }
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)
        guard Self.isValid(value) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Expected a lower-case SHA-256 digest."
            )
        }
        rawValue = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private static func isValid(_ value: String) -> Bool {
        value.utf8.count == encodedLength && value.utf8.allSatisfy {
            decimalDigitByteRange.contains($0) || lowerHexLetterByteRange.contains($0)
        }
    }
}

public enum BodyAreaSelectionLimits {
    public static let minimumCount = 1
    public static let maximumCount = 2
}

public enum BodyArea: String, CaseIterable, Codable, Sendable {
    case neck
    case upperMidBack
    case lowerBack
}

public enum AreaRole: String, Codable, Sendable {
    case primary
    case secondary
}

public enum ChangeReport: String, Codable, Sendable {
    case better
    case similar
    case worse
}

public enum MovementComfort: String, Codable, Sendable {
    case limited
    case okay
    case good
}

public enum ConditionalSafetyAnswer: String, Codable, Sendable {
    case no
    case yes
    case notSure
}

public enum SafetyStatus: String, Codable, Sendable {
    case normal
    case attentionRequired
}

public enum RoutineLevel: String, CaseIterable, Codable, Comparable, Sendable {
    case gentle
    case balanced
    case active

    /// The stable selection rank, ordered from gentlest to most active.
    public var selectionRank: Int {
        switch self {
        case .gentle: RoutineLevelRank.gentle
        case .balanced: RoutineLevelRank.balanced
        case .active: RoutineLevelRank.active
        }
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.selectionRank < rhs.selectionRank
    }
}

private enum RoutineLevelRank {
    static let gentle = 0
    static let balanced = 1
    static let active = 2
}

public enum DurationVariant: String, Codable, Sendable {
    case quick
    case standard
}

public enum RoutineStatus: String, Codable, Sendable {
    case prepared
    case inProgress
    case paused
    case completed
    case stopped
    case safetyStopped
    case abandoned

    public var isTerminal: Bool {
        switch self {
        case .completed, .stopped, .safetyStopped, .abandoned:
            true
        case .prepared, .inProgress, .paused:
            false
        }
    }

    public var acceptsFeedback: Bool {
        switch self {
        case .completed, .stopped, .safetyStopped:
            true
        case .prepared, .inProgress, .paused, .abandoned:
            false
        }
    }
}

public enum AreaResponse: String, Codable, Sendable {
    case better
    case same
    case worse
}

public enum OmissionReason: String, Codable, Sendable {
    case secondaryUnanswered
    case catalogIncompatible
    case contentUnavailable
}

public enum ReviewStatus: String, Codable, Sendable {
    case prototypePlaceholder
    case draft
    case professionallyReviewed
    case approvedForRelease
    case retired
}
