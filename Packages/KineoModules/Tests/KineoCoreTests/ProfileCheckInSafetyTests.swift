import KineoCore
import XCTest

final class ProfileCheckInSafetyTests: XCTestCase {
    func testCompletedProfileRequiresAcknowledgementsAndPrimaryArea() throws {
        XCTAssertNoThrow(
            try UserProfile(
                onboardingCompletedAt: DomainFixture.later,
                adultAcknowledged: true,
                safetyBoundaryVersion: DomainFixture.text("safety-v1"),
                safetyAcknowledgedAt: DomainFixture.time,
                primaryArea: .neck,
                secondaryArea: .lowerBack,
                routinePreference: nil,
                createdAt: DomainFixture.time,
                updatedAt: DomainFixture.later
            )
        )
        XCTAssertThrowsError(
            try UserProfile(
                onboardingCompletedAt: DomainFixture.later,
                adultAcknowledged: false,
                safetyBoundaryVersion: nil,
                safetyAcknowledgedAt: nil,
                primaryArea: nil,
                secondaryArea: nil,
                routinePreference: nil,
                createdAt: DomainFixture.time,
                updatedAt: DomainFixture.later
            )
        )
    }

    func testProfileRejectsDuplicateAreasAndInvalidGoal() {
        XCTAssertThrowsError(
            try UserProfile(
                onboardingCompletedAt: nil,
                adultAcknowledged: true,
                safetyBoundaryVersion: nil,
                safetyAcknowledgedAt: nil,
                primaryArea: .neck,
                secondaryArea: .neck,
                routinePreference: nil,
                weeklyGoalDays: 3,
                createdAt: DomainFixture.time,
                updatedAt: DomainFixture.later
            )
        )
        XCTAssertThrowsError(
            try UserProfile(
                onboardingCompletedAt: nil,
                adultAcknowledged: false,
                safetyBoundaryVersion: nil,
                safetyAcknowledgedAt: nil,
                primaryArea: nil,
                secondaryArea: nil,
                routinePreference: nil,
                weeklyGoalDays: 8,
                createdAt: DomainFixture.time,
                updatedAt: DomainFixture.later
            )
        )
    }

    func testReminderWindowAndEnabledStateAreValidated() throws {
        let window = try ReminderWindow(startMinutes: 480, endMinutes: 600)
        XCTAssertNoThrow(
            try ReminderSettings(
                enabled: true,
                window: window,
                timeZoneID: DomainFixture.text("America/Chicago"),
                updatedAt: DomainFixture.time
            )
        )
        XCTAssertThrowsError(try ReminderWindow(startMinutes: 600, endMinutes: 480))
        XCTAssertThrowsError(
            try ReminderSettings(enabled: true, window: nil, timeZoneID: nil, updatedAt: DomainFixture.time)
        )
    }

    func testConditionalAnswerExistsExactlyForTriggeredQuestions() {
        for change in [ChangeReport.better, .similar, .worse] {
            for comfort in [MovementComfort.limited, .okay, .good] {
                let requires = change == .worse || comfort == .limited
                XCTAssertEqual(
                    (try? DomainFixture.entry(
                        change: change,
                        comfort: comfort,
                        answer: requires ? .no : nil
                    ))?.requiresConditionalSafetyAnswer,
                    requires
                )
                XCTAssertThrowsError(
                    try DomainFixture.entry(
                        change: change,
                        comfort: comfort,
                        answer: requires ? nil : .no
                    )
                )
            }
        }
    }

    func testCompletedCheckInRequiresPrimaryEntryAndConsistentRole() throws {
        XCTAssertNoThrow(try DomainFixture.checkIn())
        XCTAssertThrowsError(try DomainFixture.checkIn(entries: []))
        let wrongRole = try DomainFixture.entry(role: .secondary)
        XCTAssertThrowsError(try DomainFixture.checkIn(entries: [wrongRole]))
    }

    func testAttentionCorrectionRequiresSourceInFreshAreaSet() throws {
        let source = CorrectionSource(area: .neck, triggeringEntryID: DomainFixture.id(99))
        XCTAssertNoThrow(
            try DomainFixture.checkIn(kind: .attentionCorrection, correctionSource: source)
        )
        XCTAssertThrowsError(try DomainFixture.checkIn(kind: .normal, correctionSource: source))
        let wrongArea = CorrectionSource(area: .lowerBack, triggeringEntryID: DomainFixture.id(99))
        XCTAssertThrowsError(
            try DomainFixture.checkIn(kind: .attentionCorrection, correctionSource: wrongArea)
        )
        XCTAssertNoThrow(
            try DomainFixture.checkIn(
                kind: .attentionCorrection,
                correctionSource: CorrectionSource(area: .neck, triggeringEntryID: nil)
            )
        )
    }

    func testReturnSafetyEventsPreserveAnswerAndHaveNoEntrySource() throws {
        let clear = try SafetyEvent(
            id: DomainFixture.id(10),
            area: .neck,
            kind: .attentionClearedReturnedToUsual,
            sourceCheckInEntryID: nil,
            returnAnswer: .yes,
            occurredAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        XCTAssertNoThrow(
            try SafetyMutation(
                event: clear,
                statusAfter: .normal,
                expectedAttentionUpdatedAt: DomainFixture.time
            )
        )
        XCTAssertThrowsError(
            try SafetyEvent(
                id: DomainFixture.id(11),
                area: .neck,
                kind: .attentionClearedReturnedToUsual,
                sourceCheckInEntryID: DomainFixture.id(2),
                returnAnswer: .yes,
                occurredAt: DomainFixture.time,
                dayContext: DomainFixture.day
            )
        )
        XCTAssertThrowsError(
            try SafetyEvent(
                id: DomainFixture.id(12),
                area: .neck,
                kind: .attentionReaffirmed,
                sourceCheckInEntryID: nil,
                returnAnswer: .yes,
                occurredAt: DomainFixture.time,
                dayContext: DomainFixture.day
            )
        )
    }

    func testEntrySafetyEventsRequireSourceAndMatchingResult() throws {
        XCTAssertThrowsError(
            try SafetyEvent(
                id: DomainFixture.id(10),
                area: .neck,
                kind: .attentionEntered,
                sourceCheckInEntryID: nil,
                occurredAt: DomainFixture.time,
                dayContext: DomainFixture.day
            )
        )
        let event = try SafetyEvent(
            id: DomainFixture.id(10),
            area: .neck,
            kind: .attentionEntered,
            sourceCheckInEntryID: DomainFixture.id(2),
            occurredAt: DomainFixture.time,
            dayContext: DomainFixture.day
        )
        XCTAssertThrowsError(try SafetyMutation(event: event, statusAfter: .normal))
        XCTAssertNoThrow(try SafetyMutation(event: event, statusAfter: .attentionRequired))
    }

    func testAttentionMutationRequiresStrictlyNewerEventTime() throws {
        let clear = try SafetyEvent(
            id: DomainFixture.id(40), area: .neck,
            kind: .attentionClearedReturnedToUsual,
            sourceCheckInEntryID: nil, returnAnswer: .yes,
            occurredAt: DomainFixture.time, dayContext: DomainFixture.day
        )

        XCTAssertThrowsError(
            try SafetyMutation(
                event: clear,
                statusAfter: .normal,
                expectedAttentionUpdatedAt: DomainFixture.time
            )
        )
    }

    func testCompleteCommandRequiresMutationForEveryTriggeringEntry() throws {
        let entry = try DomainFixture.entry(change: .worse, comfort: .good, answer: .notSure)
        let checkIn = try DomainFixture.checkIn(entries: [entry])
        XCTAssertThrowsError(try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: []))

        let event = try SafetyEvent(
            id: DomainFixture.id(10),
            area: .neck,
            kind: .attentionEntered,
            sourceCheckInEntryID: entry.id,
            occurredAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        let mutation = try SafetyMutation(event: event, statusAfter: .attentionRequired)
        XCTAssertNoThrow(try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [mutation]))
    }

    func testCompletedCorrectionRequiresCorrectionEvent() throws {
        let entry = try DomainFixture.entry()
        let source = CorrectionSource(area: .neck, triggeringEntryID: DomainFixture.id(99))
        let checkIn = try DomainFixture.checkIn(
            kind: .attentionCorrection,
            correctionSource: source,
            entries: [entry]
        )
        XCTAssertThrowsError(try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: []))
        let clear = try SafetyEvent(
            id: DomainFixture.id(13),
            area: .neck,
            kind: .attentionClearedCorrection,
            sourceCheckInEntryID: entry.id,
            occurredAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        let mutation = try SafetyMutation(
            event: clear,
            statusAfter: .normal,
            expectedAttentionUpdatedAt: DomainFixture.time
        )
        XCTAssertNoThrow(try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [mutation]))
    }

    func testCompleteCommandRejectsExtraMutationFromNontriggeringEntry() throws {
        let primary = try DomainFixture.entry(
            id: 2,
            area: .neck,
            role: .primary,
            change: .worse,
            comfort: .good,
            answer: .yes
        )
        let secondary = try DomainFixture.entry(
            id: 3,
            area: .lowerBack,
            role: .secondary
        )
        let checkIn = try CheckIn(
            id: DomainFixture.id(1),
            status: .completed,
            primaryArea: .neck,
            secondaryArea: .lowerBack,
            startedAt: DomainFixture.time,
            completedAt: DomainFixture.later,
            dayContext: DomainFixture.day,
            entries: [primary, secondary]
        )
        let requiredEvent = try SafetyEvent(
            id: DomainFixture.id(14),
            area: .neck,
            kind: .attentionEntered,
            sourceCheckInEntryID: primary.id,
            occurredAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        let extraEvent = try SafetyEvent(
            id: DomainFixture.id(15),
            area: .lowerBack,
            kind: .attentionEntered,
            sourceCheckInEntryID: secondary.id,
            occurredAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        let required = try SafetyMutation(event: requiredEvent, statusAfter: .attentionRequired)
        let extra = try SafetyMutation(event: extraEvent, statusAfter: .attentionRequired)
        XCTAssertThrowsError(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [required, extra])
        )
    }
}
