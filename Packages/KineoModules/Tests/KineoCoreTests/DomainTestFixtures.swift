import Foundation
import KineoCore

enum DomainFixture {
    static let time = TimestampMilliseconds(rawValue: 1_800_000_000_000)
    static let later = TimestampMilliseconds(rawValue: 1_800_000_001_000)

    static var day: LocalDayContext {
        LocalDayContext(
            localDay: LocalDay(rawValue: "2027-01-15")!,
            timeZoneID: NonEmptyString(rawValue: "America/Chicago")!,
            calendarID: NonEmptyString(rawValue: "gregorian")!
        )
    }

    static func id<Kind>(_ number: Int) -> StableID<Kind> {
        StableID(rawValue: String(format: "00000000-0000-0000-0000-%012d", number))!
    }

    static func text(_ value: String) -> NonEmptyString {
        NonEmptyString(rawValue: value)!
    }

    static var digest: SHA256Digest {
        SHA256Digest(rawValue: String(repeating: "a", count: 64))!
    }

    static func entry(
        id number: Int = 2,
        area: BodyArea = .neck,
        role: AreaRole = .primary,
        change: ChangeReport = .similar,
        comfort: MovementComfort = .good,
        answer: ConditionalSafetyAnswer? = nil
    ) throws -> CheckInEntry {
        try CheckInEntry(
            id: id(number),
            area: area,
            role: role,
            changeReport: change,
            movementComfort: comfort,
            conditionalSafetyAnswer: answer,
            submittedAt: later
        )
    }

    static func checkIn(
        status: CheckInStatus = .completed,
        kind: CheckInKind = .normal,
        correctionSource: CorrectionSource? = nil,
        entries: [CheckInEntry]? = nil
    ) throws -> CheckIn {
        try CheckIn(
            id: id(1),
            status: status,
            kind: kind,
            correctionSource: correctionSource,
            primaryArea: .neck,
            secondaryArea: nil,
            startedAt: time,
            completedAt: status == .completed ? later : nil,
            dayContext: day,
            entries: entries ?? [entry()]
        )
    }

    static func areaInput() throws -> DecisionAreaInput {
        try DecisionAreaInput(
            area: .neck,
            role: .primary,
            checkInEntryID: id(2),
            baseLevel: .balanced,
            activeUnlocked: false,
            qualifyingCount: 0,
            latestResponse: nil,
            included: true
        )
    }

    static func selectedDecision(
        id number: Int = 5,
        revision: Int = 1,
        recommended: RoutineLevel = .balanced,
        requestedOverride: RoutineLevel? = nil,
        disposition: OverrideDisposition = .none,
        selected: RoutineLevel = .balanced,
        delivered: RoutineLevel = .balanced
    ) throws -> SelectionDecision {
        try SelectionDecision(
            id: id(number),
            checkInID: id(1),
            revision: revision,
            rulesVersion: text("rules-v1"),
            catalogVersionRequested: text("catalog-v1"),
            catalogVersionDelivered: text("catalog-v1"),
            outcome: .selected,
            recommendedLevel: recommended,
            requestedOverride: requestedOverride,
            overrideDisposition: disposition,
            selectedLevel: selected,
            deliveredLevel: delivered,
            durationVariant: .standard,
            secondaryOmissionReason: nil,
            validationResult: .exact,
            primaryTemplateID: text("neck-balanced-standard"),
            primaryTemplateRevision: 1,
            secondaryModuleID: nil,
            secondaryModuleRevision: nil,
            compatibilityRuleID: nil,
            compositionFingerprint: digest,
            createdAt: later,
            areaInputs: [areaInput()],
            reasons: [],
            notices: []
        )
    }

    static func routineSnapshot(areas: [BodyArea] = [.neck]) throws -> OpaqueRoutineSnapshot {
        try OpaqueRoutineSnapshot(
            bytes: Data("{\"version\":1}".utf8),
            checksum: digest,
            includedAreas: areas
        )
    }

    static func routineSession(
        status: RoutineStatus = .completed,
        id number: Int = 6
    ) throws -> RoutineSession {
        let started = status == .prepared ? nil : time
        let ended = status.isTerminal ? later : nil
        return try RoutineSession(
            id: id(number),
            decisionID: id(5),
            checkInID: id(1),
            status: status,
            snapshot: routineSnapshot(),
            currentStepIndex: 0,
            stepElapsedMilliseconds: 0,
            startedAt: started,
            updatedAt: later,
            endedAt: ended,
            dayContext: day
        )
    }
}
