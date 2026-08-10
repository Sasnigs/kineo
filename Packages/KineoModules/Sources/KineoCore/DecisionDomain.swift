import Foundation

public enum SelectionOutcome: String, Codable, Sendable {
    case selected
    case contentUnavailable
}

public enum OverrideDisposition: String, Codable, Sendable {
    case none
    case acceptedGentler
    case sameAsRecommended
    case rejectedHigher
}

public enum ValidationResult: String, Codable, Sendable {
    case exact
    case fallback
    case unavailable
}

public enum DecisionReasonKind: String, Codable, Sendable {
    case selection
    case presented
}

public struct CanonicalJSON: Equatable, Sendable, Codable {
    public let bytes: Data

    public init(bytes: Data) throws {
        guard !bytes.isEmpty else {
            throw DomainValidationError.emptyValue("canonicalJSON")
        }
        let value = try JSONSerialization.jsonObject(with: bytes)
        guard value is [String: Any] else {
            throw DomainValidationError.invariantViolation("Canonical parameters must be a JSON object.")
        }
        self.bytes = bytes
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        do {
            try self.init(bytes: values.decode(Data.self, forKey: .bytes))
        } catch {
            throw DecodingError.dataCorruptedError(
                forKey: .bytes,
                in: values,
                debugDescription: "Expected valid JSON bytes."
            )
        }
    }
}

public struct DecisionAreaInput: Equatable, Sendable, Codable {
    public let area: BodyArea
    public let role: AreaRole
    public let checkInEntryID: CheckInEntryID
    public let baseLevel: RoutineLevel
    public let activeUnlocked: Bool
    public let qualifyingCount: Int
    public let latestResponse: AreaResponse?
    public let included: Bool

    public init(
        area: BodyArea,
        role: AreaRole,
        checkInEntryID: CheckInEntryID,
        baseLevel: RoutineLevel,
        activeUnlocked: Bool,
        qualifyingCount: Int,
        latestResponse: AreaResponse?,
        included: Bool
    ) throws {
        guard qualifyingCount >= 0 else {
            throw DomainValidationError.invalidRange("qualifyingCount")
        }
        guard role != .primary || included else {
            throw DomainValidationError.invariantViolation("The primary decision input must be included.")
        }
        self.area = area
        self.role = role
        self.checkInEntryID = checkInEntryID
        self.baseLevel = baseLevel
        self.activeUnlocked = activeUnlocked
        self.qualifyingCount = qualifyingCount
        self.latestResponse = latestResponse
        self.included = included
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            area: values.decode(BodyArea.self, forKey: .area),
            role: values.decode(AreaRole.self, forKey: .role),
            checkInEntryID: values.decode(CheckInEntryID.self, forKey: .checkInEntryID),
            baseLevel: values.decode(RoutineLevel.self, forKey: .baseLevel),
            activeUnlocked: values.decode(Bool.self, forKey: .activeUnlocked),
            qualifyingCount: values.decode(Int.self, forKey: .qualifyingCount),
            latestResponse: values.decodeIfPresent(AreaResponse.self, forKey: .latestResponse),
            included: values.decode(Bool.self, forKey: .included)
        )
    }
}

public struct DecisionReason: Equatable, Sendable, Codable {
    public let kind: DecisionReasonKind
    public let position: Int
    public let code: NonEmptyString
    public let parameters: CanonicalJSON

    public init(
        kind: DecisionReasonKind,
        position: Int,
        code: NonEmptyString,
        parameters: CanonicalJSON
    ) throws {
        guard (0...1).contains(position) else {
            throw DomainValidationError.invalidRange("decisionReasonPosition")
        }
        self.kind = kind
        self.position = position
        self.code = code
        self.parameters = parameters
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            kind: values.decode(DecisionReasonKind.self, forKey: .kind),
            position: values.decode(Int.self, forKey: .position),
            code: values.decode(NonEmptyString.self, forKey: .code),
            parameters: values.decode(CanonicalJSON.self, forKey: .parameters)
        )
    }
}

public struct DecisionNotice: Equatable, Sendable, Codable {
    public let position: Int
    public let code: NonEmptyString
    public let area: BodyArea?
    public let parameters: CanonicalJSON

    public init(
        position: Int,
        code: NonEmptyString,
        area: BodyArea?,
        parameters: CanonicalJSON
    ) throws {
        guard position >= 0 else {
            throw DomainValidationError.invalidRange("decisionNoticePosition")
        }
        self.position = position
        self.code = code
        self.area = area
        self.parameters = parameters
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            position: values.decode(Int.self, forKey: .position),
            code: values.decode(NonEmptyString.self, forKey: .code),
            area: values.decodeIfPresent(BodyArea.self, forKey: .area),
            parameters: values.decode(CanonicalJSON.self, forKey: .parameters)
        )
    }
}

public struct SelectionDecision: Equatable, Sendable, Codable {
    private static let requiredPrimaryAreaCount = 1
    private static let maximumSecondaryAreaCount = 1

    public let id: SelectionDecisionID
    public let checkInID: CheckInID
    public let revision: Int
    public let rulesVersion: NonEmptyString
    public let catalogVersionRequested: NonEmptyString
    public let catalogVersionDelivered: NonEmptyString?
    public let outcome: SelectionOutcome
    public let recommendedLevel: RoutineLevel
    public let requestedOverride: RoutineLevel?
    public let overrideDisposition: OverrideDisposition
    public let selectedLevel: RoutineLevel
    public let deliveredLevel: RoutineLevel?
    public let durationVariant: DurationVariant
    public let secondaryOmissionReason: OmissionReason?
    public let validationResult: ValidationResult
    public let primaryTemplateID: NonEmptyString?
    public let primaryTemplateRevision: Int?
    public let secondaryModuleID: NonEmptyString?
    public let secondaryModuleRevision: Int?
    public let compatibilityRuleID: NonEmptyString?
    public let compositionFingerprint: SHA256Digest?
    public let createdAt: TimestampMilliseconds
    public let areaInputs: [DecisionAreaInput]
    public let reasons: [DecisionReason]
    public let notices: [DecisionNotice]

    public init(
        id: SelectionDecisionID,
        checkInID: CheckInID,
        revision: Int,
        rulesVersion: NonEmptyString,
        catalogVersionRequested: NonEmptyString,
        catalogVersionDelivered: NonEmptyString?,
        outcome: SelectionOutcome,
        recommendedLevel: RoutineLevel,
        requestedOverride: RoutineLevel?,
        overrideDisposition: OverrideDisposition,
        selectedLevel: RoutineLevel,
        deliveredLevel: RoutineLevel?,
        durationVariant: DurationVariant,
        secondaryOmissionReason: OmissionReason?,
        validationResult: ValidationResult,
        primaryTemplateID: NonEmptyString?,
        primaryTemplateRevision: Int?,
        secondaryModuleID: NonEmptyString?,
        secondaryModuleRevision: Int?,
        compatibilityRuleID: NonEmptyString?,
        compositionFingerprint: SHA256Digest?,
        createdAt: TimestampMilliseconds,
        areaInputs: [DecisionAreaInput],
        reasons: [DecisionReason],
        notices: [DecisionNotice]
    ) throws {
        guard revision >= 1 else {
            throw DomainValidationError.invalidRange("decisionRevision")
        }
        guard selectedLevel <= recommendedLevel else {
            throw DomainValidationError.invariantViolation("Selected level cannot exceed the recommendation.")
        }
        if let deliveredLevel {
            guard deliveredLevel <= selectedLevel else {
                throw DomainValidationError.invariantViolation("Delivered level cannot exceed the selected level.")
            }
        }
        try Self.validateOverride(
            requested: requestedOverride,
            disposition: overrideDisposition,
            recommended: recommendedLevel,
            selected: selectedLevel
        )
        try Self.validateOutcome(
            outcome: outcome,
            catalogVersionDelivered: catalogVersionDelivered,
            deliveredLevel: deliveredLevel,
            validationResult: validationResult,
            primaryTemplateID: primaryTemplateID,
            primaryTemplateRevision: primaryTemplateRevision,
            secondaryModuleID: secondaryModuleID,
            secondaryModuleRevision: secondaryModuleRevision,
            compatibilityRuleID: compatibilityRuleID,
            compositionFingerprint: compositionFingerprint
        )
        guard (BodyAreaSelectionLimits.minimumCount...BodyAreaSelectionLimits.maximumCount)
            .contains(areaInputs.count),
              Set(areaInputs.map(\.area)).count == areaInputs.count,
              areaInputs.count(where: { $0.role == .primary }) == Self.requiredPrimaryAreaCount,
              areaInputs.count(where: { $0.role == .secondary }) <= Self.maximumSecondaryAreaCount else {
            throw DomainValidationError.invariantViolation("Decision area inputs must contain one primary and at most one secondary.")
        }
        let reasonKeys = reasons.map { "\($0.kind.rawValue):\($0.position)" }
        guard Set(reasonKeys).count == reasonKeys.count else {
            throw DomainValidationError.invariantViolation("Decision reason positions must be unique by kind.")
        }
        guard Set(notices.map(\.position)).count == notices.count else {
            throw DomainValidationError.invariantViolation("Decision notice positions must be unique.")
        }

        self.id = id
        self.checkInID = checkInID
        self.revision = revision
        self.rulesVersion = rulesVersion
        self.catalogVersionRequested = catalogVersionRequested
        self.catalogVersionDelivered = catalogVersionDelivered
        self.outcome = outcome
        self.recommendedLevel = recommendedLevel
        self.requestedOverride = requestedOverride
        self.overrideDisposition = overrideDisposition
        self.selectedLevel = selectedLevel
        self.deliveredLevel = deliveredLevel
        self.durationVariant = durationVariant
        self.secondaryOmissionReason = secondaryOmissionReason
        self.validationResult = validationResult
        self.primaryTemplateID = primaryTemplateID
        self.primaryTemplateRevision = primaryTemplateRevision
        self.secondaryModuleID = secondaryModuleID
        self.secondaryModuleRevision = secondaryModuleRevision
        self.compatibilityRuleID = compatibilityRuleID
        self.compositionFingerprint = compositionFingerprint
        self.createdAt = createdAt
        self.areaInputs = areaInputs
        self.reasons = reasons
        self.notices = notices
    }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: values.decode(SelectionDecisionID.self, forKey: .id),
            checkInID: values.decode(CheckInID.self, forKey: .checkInID),
            revision: values.decode(Int.self, forKey: .revision),
            rulesVersion: values.decode(NonEmptyString.self, forKey: .rulesVersion),
            catalogVersionRequested: values.decode(NonEmptyString.self, forKey: .catalogVersionRequested),
            catalogVersionDelivered: values.decodeIfPresent(NonEmptyString.self, forKey: .catalogVersionDelivered),
            outcome: values.decode(SelectionOutcome.self, forKey: .outcome),
            recommendedLevel: values.decode(RoutineLevel.self, forKey: .recommendedLevel),
            requestedOverride: values.decodeIfPresent(RoutineLevel.self, forKey: .requestedOverride),
            overrideDisposition: values.decode(OverrideDisposition.self, forKey: .overrideDisposition),
            selectedLevel: values.decode(RoutineLevel.self, forKey: .selectedLevel),
            deliveredLevel: values.decodeIfPresent(RoutineLevel.self, forKey: .deliveredLevel),
            durationVariant: values.decode(DurationVariant.self, forKey: .durationVariant),
            secondaryOmissionReason: values.decodeIfPresent(OmissionReason.self, forKey: .secondaryOmissionReason),
            validationResult: values.decode(ValidationResult.self, forKey: .validationResult),
            primaryTemplateID: values.decodeIfPresent(NonEmptyString.self, forKey: .primaryTemplateID),
            primaryTemplateRevision: values.decodeIfPresent(Int.self, forKey: .primaryTemplateRevision),
            secondaryModuleID: values.decodeIfPresent(NonEmptyString.self, forKey: .secondaryModuleID),
            secondaryModuleRevision: values.decodeIfPresent(Int.self, forKey: .secondaryModuleRevision),
            compatibilityRuleID: values.decodeIfPresent(NonEmptyString.self, forKey: .compatibilityRuleID),
            compositionFingerprint: values.decodeIfPresent(SHA256Digest.self, forKey: .compositionFingerprint),
            createdAt: values.decode(TimestampMilliseconds.self, forKey: .createdAt),
            areaInputs: values.decode([DecisionAreaInput].self, forKey: .areaInputs),
            reasons: values.decode([DecisionReason].self, forKey: .reasons),
            notices: values.decode([DecisionNotice].self, forKey: .notices)
        )
    }

    private static func validateOverride(
        requested: RoutineLevel?,
        disposition: OverrideDisposition,
        recommended: RoutineLevel,
        selected: RoutineLevel
    ) throws {
        let isValid: Bool
        switch disposition {
        case .none:
            isValid = requested == nil && selected == recommended
        case .acceptedGentler:
            isValid = requested.map { $0 < recommended && selected == $0 } ?? false
        case .sameAsRecommended:
            isValid = requested == recommended && selected == recommended
        case .rejectedHigher:
            isValid = requested.map { $0 > recommended && selected == recommended } ?? false
        }
        guard isValid else {
            throw DomainValidationError.invariantViolation("Override fields are inconsistent.")
        }
    }

    private static func validateOutcome(
        outcome: SelectionOutcome,
        catalogVersionDelivered: NonEmptyString?,
        deliveredLevel: RoutineLevel?,
        validationResult: ValidationResult,
        primaryTemplateID: NonEmptyString?,
        primaryTemplateRevision: Int?,
        secondaryModuleID: NonEmptyString?,
        secondaryModuleRevision: Int?,
        compatibilityRuleID: NonEmptyString?,
        compositionFingerprint: SHA256Digest?
    ) throws {
        guard primaryTemplateRevision.map({ $0 >= 1 }) ?? true,
              secondaryModuleRevision.map({ $0 >= 1 }) ?? true else {
            throw DomainValidationError.invalidRange("contentRevision")
        }
        guard (secondaryModuleID == nil) == (secondaryModuleRevision == nil),
              (secondaryModuleID == nil) == (compatibilityRuleID == nil) else {
            throw DomainValidationError.invariantViolation("Secondary composition fields must appear together.")
        }
        switch outcome {
        case .selected:
            guard catalogVersionDelivered != nil,
                  deliveredLevel != nil,
                  validationResult != .unavailable,
                  primaryTemplateID != nil,
                  let primaryTemplateRevision,
                  primaryTemplateRevision >= 1,
                  compositionFingerprint != nil else {
                throw DomainValidationError.invariantViolation("A selected decision requires delivered content audit fields.")
            }
        case .contentUnavailable:
            guard catalogVersionDelivered == nil,
                  deliveredLevel == nil,
                  validationResult == .unavailable,
                  primaryTemplateID == nil,
                  primaryTemplateRevision == nil,
                  secondaryModuleID == nil,
                  secondaryModuleRevision == nil,
                  compatibilityRuleID == nil,
                  compositionFingerprint == nil else {
                throw DomainValidationError.invariantViolation("Unavailable content cannot contain delivered content fields.")
            }
        }
    }
}
