/// Validation failures at the catalog boundary.
public enum CatalogValidationError: Error, Equatable, Sendable {
    case invalidIdentifier(String)
    case invalidRevision
    case invalidDuration(String)
    case invalidDose
    case invalidMetadata(String)
}

/// A stable lowercase namespaced catalog identifier.
public struct CatalogID: Hashable, Codable, Sendable, RawRepresentable {
    public let rawValue: String

    public init?(rawValue: String) {
        guard Self.isValid(rawValue) else { return nil }
        self.rawValue = rawValue
    }

    public init(validating rawValue: String) throws(CatalogValidationError) {
        guard Self.isValid(rawValue) else { throw .invalidIdentifier(rawValue) }
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        guard Self.isValid(value) else {
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Expected a lowercase namespaced catalog identifier."
            )
        }
        rawValue = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    private static func isValid(_ value: String) -> Bool {
        let segments = value.utf8.split(
            separator: CatalogIDCharacters.namespaceSeparator,
            omittingEmptySubsequences: false
        )
        guard segments.count >= CatalogIDCharacters.minimumNamespaceSegmentCount else { return false }
        return segments.allSatisfy { segment in
            guard let first = segment.first, let last = segment.last,
                  CatalogIDCharacters.isAlphaNumeric(first),
                  CatalogIDCharacters.isAlphaNumeric(last) else {
                return false
            }
            return segment.allSatisfy(CatalogIDCharacters.isAllowed)
        }
    }
}

private enum CatalogIDCharacters {
    static let namespaceSeparator: UInt8 = 46
    static let hyphen: UInt8 = 45
    static let zero: UInt8 = 48
    static let nine: UInt8 = 57
    static let lowerA: UInt8 = 97
    static let lowerZ: UInt8 = 122
    static let minimumNamespaceSegmentCount = 2

    static func isAlphaNumeric(_ byte: UInt8) -> Bool {
        (zero...nine).contains(byte) || (lowerA...lowerZ).contains(byte)
    }

    static func isAllowed(_ byte: UInt8) -> Bool {
        isAlphaNumeric(byte) || byte == hyphen
    }
}

/// A positive immutable content revision.
public struct ContentRevision: Hashable, Comparable, Codable, Sendable, RawRepresentable {
    public let rawValue: Int

    public init?(rawValue: Int) {
        guard rawValue >= CatalogRevisionLimits.first else { return nil }
        self.rawValue = rawValue
    }

    public init(validating rawValue: Int) throws(CatalogValidationError) {
        guard rawValue >= CatalogRevisionLimits.first else { throw .invalidRevision }
        self.rawValue = rawValue
    }

    public init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer().decode(Int.self)
        guard value >= CatalogRevisionLimits.first else {
            throw DecodingError.dataCorruptedError(
                in: try decoder.singleValueContainer(),
                debugDescription: "Expected a positive content revision."
            )
        }
        rawValue = value
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

private enum CatalogRevisionLimits {
    static let first = 1
}

public enum BuildChannel: String, Codable, Sendable {
    case internalPrototype = "internal_prototype"
    case publicRelease = "public_release"
}

public enum ContentRole: String, Codable, Sendable {
    case primaryTemplate = "primary_template"
    case secondaryModule = "secondary_module"
    case fragment
    case movement
}

public enum SequenceItemKind: String, Codable, Sendable {
    case movement
    case transition
    case rest
    case replacementSlot = "replacement_slot"
}

public enum DoseKind: String, Codable, Sendable {
    case timed
    case repetitions
}

public enum MovementPosition: String, Codable, Sendable {
    case seated
    case standing
    case floor
    case adaptable
    case prototypeAbstract = "prototype_abstract"
}

public enum SlotKind: String, Codable, Sendable {
    case secondaryFocus = "secondary_focus"
}

public enum AlternativeReason: String, Codable, Sendable {
    case uncomfortable
    case unclear
    case notEnoughSpace
    case userPreference
}

/// Immutable prototype timing constants.
public enum PrototypeCatalogDurations {
    public static let quickNominalSeconds = 300
    public static let quickMinimumSeconds = 270
    public static let quickMaximumSeconds = 360
    public static let standardNominalSeconds = 600
    public static let standardMinimumSeconds = 480
    public static let standardMaximumSeconds = 720
}

/// Valid duration bounds for one authored variant.
public struct DurationPolicy: Equatable, Codable, Sendable {
    public let variant: DurationVariant
    public let nominalSeconds: Int
    public let minimumSeconds: Int
    public let maximumSeconds: Int

    public init(
        variant: DurationVariant,
        nominalSeconds: Int,
        minimumSeconds: Int,
        maximumSeconds: Int
    ) throws(CatalogValidationError) {
        guard minimumSeconds > 0,
              minimumSeconds <= nominalSeconds,
              nominalSeconds <= maximumSeconds else {
            throw .invalidDuration(variant.rawValue)
        }
        self.variant = variant
        self.nominalSeconds = nominalSeconds
        self.minimumSeconds = minimumSeconds
        self.maximumSeconds = maximumSeconds
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let variant = try values.decode(DurationVariant.self, forKey: .variant)
        do {
            try self.init(
                variant: variant,
                nominalSeconds: values.decode(Int.self, forKey: .nominalSeconds),
                minimumSeconds: values.decode(Int.self, forKey: .minimumSeconds),
                maximumSeconds: values.decode(Int.self, forKey: .maximumSeconds)
            )
        } catch {
            throw DecodingError.dataCorruptedError(
                forKey: .nominalSeconds,
                in: values,
                debugDescription: "Expected positive ordered duration bounds."
            )
        }
    }
}

/// Review and localization metadata shared by catalog records.
public struct ContentMetadata: Equatable, Codable, Sendable {
    public let id: CatalogID
    public let revision: ContentRevision
    public let reviewStatus: ReviewStatus
    public let locale: String
    public let displayNameKey: NonEmptyString
    public let accessibilityDescriptionKey: NonEmptyString?
    public let contentOwner: NonEmptyString
    public let reviewedBy: NonEmptyString?
    public let reviewedAt: TimestampMilliseconds?
    public let reviewEvidenceID: NonEmptyString?
    public let intendedBuilds: Set<BuildChannel>

    public init(
        id: CatalogID,
        revision: ContentRevision,
        reviewStatus: ReviewStatus,
        locale: String,
        displayNameKey: NonEmptyString,
        accessibilityDescriptionKey: NonEmptyString?,
        contentOwner: NonEmptyString,
        reviewedBy: NonEmptyString?,
        reviewedAt: TimestampMilliseconds?,
        reviewEvidenceID: NonEmptyString?,
        intendedBuilds: Set<BuildChannel>
    ) throws(CatalogValidationError) {
        guard locale == CatalogLocales.englishUnitedStates else {
            throw .invalidMetadata("locale")
        }
        if reviewStatus == .prototypePlaceholder {
            guard reviewedBy == nil, reviewedAt == nil, reviewEvidenceID == nil,
                  !intendedBuilds.contains(.publicRelease) else {
                throw .invalidMetadata("prototypeReview")
            }
        }
        self.id = id
        self.revision = revision
        self.reviewStatus = reviewStatus
        self.locale = locale
        self.displayNameKey = displayNameKey
        self.accessibilityDescriptionKey = accessibilityDescriptionKey
        self.contentOwner = contentOwner
        self.reviewedBy = reviewedBy
        self.reviewedAt = reviewedAt
        self.reviewEvidenceID = reviewEvidenceID
        self.intendedBuilds = intendedBuilds
    }

    /// Whether this record is selectable in the requested build channel.
    public func isEligible(for channel: BuildChannel) -> Bool {
        guard intendedBuilds.contains(channel) else { return false }
        switch channel {
        case .internalPrototype:
            return reviewStatus == .prototypePlaceholder ||
                reviewStatus == .professionallyReviewed ||
                reviewStatus == .approvedForRelease
        case .publicRelease:
            return reviewStatus == .approvedForRelease &&
                reviewedBy != nil && reviewedAt != nil && reviewEvidenceID != nil
        }
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                id: values.decode(CatalogID.self, forKey: .id),
                revision: values.decode(ContentRevision.self, forKey: .revision),
                reviewStatus: values.decode(ReviewStatus.self, forKey: .reviewStatus),
                locale: values.decode(String.self, forKey: .locale),
                displayNameKey: values.decode(NonEmptyString.self, forKey: .displayNameKey),
                accessibilityDescriptionKey: values.decodeIfPresent(
                    NonEmptyString.self,
                    forKey: .accessibilityDescriptionKey
                ),
                contentOwner: values.decode(NonEmptyString.self, forKey: .contentOwner),
                reviewedBy: values.decodeIfPresent(NonEmptyString.self, forKey: .reviewedBy),
                reviewedAt: values.decodeIfPresent(TimestampMilliseconds.self, forKey: .reviewedAt),
                reviewEvidenceID: values.decodeIfPresent(
                    NonEmptyString.self,
                    forKey: .reviewEvidenceID
                ),
                intendedBuilds: values.decode(Set<BuildChannel>.self, forKey: .intendedBuilds)
            )
        } catch let error as CatalogValidationError {
            throw DecodingError.dataCorruptedError(
                forKey: .reviewStatus,
                in: values,
                debugDescription: "Invalid catalog metadata: \(error)."
            )
        }
    }
}

private enum CatalogLocales {
    static let englishUnitedStates = "en-US"
}

/// Authored movement dose and its timer estimate.
public struct Dose: Equatable, Codable, Sendable {
    public let kind: DoseKind
    public let activeSeconds: Int?
    public let repetitionCount: Int?
    public let estimatedSeconds: Int

    public init(
        kind: DoseKind,
        activeSeconds: Int?,
        repetitionCount: Int?,
        estimatedSeconds: Int
    ) throws(CatalogValidationError) {
        guard estimatedSeconds > 0 else { throw .invalidDose }
        switch kind {
        case .timed:
            guard let activeSeconds, activeSeconds > 0, repetitionCount == nil else {
                throw .invalidDose
            }
        case .repetitions:
            guard let repetitionCount, repetitionCount > 0, activeSeconds == nil else {
                throw .invalidDose
            }
        }
        self.kind = kind
        self.activeSeconds = activeSeconds
        self.repetitionCount = repetitionCount
        self.estimatedSeconds = estimatedSeconds
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(
                kind: values.decode(DoseKind.self, forKey: .kind),
                activeSeconds: values.decodeIfPresent(Int.self, forKey: .activeSeconds),
                repetitionCount: values.decodeIfPresent(Int.self, forKey: .repetitionCount),
                estimatedSeconds: values.decode(Int.self, forKey: .estimatedSeconds)
            )
        } catch {
            throw DecodingError.dataCorruptedError(
                forKey: .kind,
                in: values,
                debugDescription: "Dose fields do not match the dose kind."
            )
        }
    }
}
