import Foundation
import KineoCore
import XCTest

final class SnapshotCodableTests: XCTestCase {
    func testValidatedRecordsRoundTripThroughCodable() throws {
        let checkIn = try DomainFixture.checkIn()
        let decision = try DomainFixture.selectedDecision()
        let session = try DomainFixture.routineSession()
        XCTAssertEqual(
            try JSONDecoder().decode(CheckIn.self, from: JSONEncoder().encode(checkIn)),
            checkIn
        )
        XCTAssertEqual(
            try JSONDecoder().decode(SelectionDecision.self, from: JSONEncoder().encode(decision)),
            decision
        )
        XCTAssertEqual(
            try JSONDecoder().decode(RoutineSession.self, from: JSONEncoder().encode(session)),
            session
        )
    }

    func testDecodeRevalidatesCheckInInvariant() throws {
        let checkIn = try DomainFixture.checkIn()
        let encoded = try JSONEncoder().encode(checkIn)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object["completedAt"] = NSNull()
        let invalid = try JSONSerialization.data(withJSONObject: object)
        XCTAssertThrowsError(try JSONDecoder().decode(CheckIn.self, from: invalid))
    }

    func testSnapshotValidatesRelationshipsAndFeedbackArea() throws {
        let checkIn = try DomainFixture.checkIn()
        let decision = try DomainFixture.selectedDecision()
        let session = try DomainFixture.routineSession()
        let started = try RoutineEvent(
            id: DomainFixture.id(7), routineSessionID: session.id, sequenceNumber: 1,
            kind: .started, stepID: nil, moduleID: nil, alternativeID: nil,
            localReason: nil, occurredAt: DomainFixture.time
        )
        let completed = try RoutineEvent(
            id: DomainFixture.id(8), routineSessionID: session.id, sequenceNumber: 2,
            kind: .completed, stepID: nil, moduleID: nil, alternativeID: nil,
            localReason: nil, occurredAt: DomainFixture.later
        )
        let validResponse = FeedbackResponse(
            id: DomainFixture.id(20),
            area: .neck,
            response: .same
        )
        let validSubmission = try FeedbackSubmission(
            id: DomainFixture.id(21),
            routineSessionID: session.id,
            responses: [validResponse],
            submittedAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        XCTAssertNoThrow(
            try KineoDataSnapshot(
                profileState: nil,
                checkIns: [checkIn],
                attentionStates: [],
                safetyEvents: [],
                pauseTodayEvents: [],
                decisions: [decision],
                routineSessions: [session],
                routineEvents: [started, completed],
                feedbackSubmissions: [validSubmission]
            )
        )

        let wrongArea = FeedbackResponse(
            id: DomainFixture.id(22),
            area: .lowerBack,
            response: .same
        )
        let invalidSubmission = try FeedbackSubmission(
            id: DomainFixture.id(23),
            routineSessionID: session.id,
            responses: [wrongArea],
            submittedAt: DomainFixture.later,
            dayContext: DomainFixture.day
        )
        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil,
                checkIns: [checkIn],
                attentionStates: [],
                safetyEvents: [],
                pauseTodayEvents: [],
                decisions: [decision],
                routineSessions: [session],
                routineEvents: [started, completed],
                feedbackSubmissions: [invalidSubmission]
            )
        )

        let earlySubmission = try FeedbackSubmission(
            id: DomainFixture.id(24),
            routineSessionID: session.id,
            responses: [validResponse],
            submittedAt: DomainFixture.time,
            dayContext: DomainFixture.day
        )
        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil,
                checkIns: [checkIn],
                attentionStates: [],
                safetyEvents: [],
                pauseTodayEvents: [],
                decisions: [decision],
                routineSessions: [session],
                routineEvents: [started, completed],
                feedbackSubmissions: [earlySubmission]
            )
        )
    }

    func testSnapshotRejectsDecisionThatOmitsACompletedEntry() throws {
        let primary = try DomainFixture.entry()
        let secondary = try DomainFixture.entry(id: 3, area: .lowerBack, role: .secondary)
        let checkIn = try CheckIn(
            id: DomainFixture.id(1), status: .completed, primaryArea: .neck,
            secondaryArea: .lowerBack, startedAt: DomainFixture.time,
            completedAt: DomainFixture.later, dayContext: DomainFixture.day,
            entries: [primary, secondary]
        )
        let decision = try DomainFixture.selectedDecision()

        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil, checkIns: [checkIn], attentionStates: [],
                safetyEvents: [], pauseTodayEvents: [], decisions: [decision],
                routineSessions: [], routineEvents: [], feedbackSubmissions: []
            )
        )
    }

    func testSnapshotRejectsRoutineAreasThatDifferFromDecisionInputs() throws {
        let checkIn = try DomainFixture.checkIn()
        let decision = try DomainFixture.selectedDecision()
        let baseline = try DomainFixture.routineSession(status: .prepared)
        let session = try RoutineSession(
            id: baseline.id,
            decisionID: baseline.decisionID,
            checkInID: baseline.checkInID,
            status: .prepared,
            snapshot: DomainFixture.routineSnapshot(areas: [.lowerBack]),
            currentStepIndex: 0,
            stepElapsedMilliseconds: 0,
            startedAt: nil,
            updatedAt: baseline.updatedAt,
            endedAt: nil,
            dayContext: baseline.dayContext
        )

        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil, checkIns: [checkIn], attentionStates: [],
                safetyEvents: [], pauseTodayEvents: [], decisions: [decision],
                routineSessions: [session], routineEvents: [], feedbackSubmissions: []
            )
        )
    }

    func testSnapshotRejectsCrossCheckInDecisionInput() throws {
        let checkIn = try DomainFixture.checkIn()
        let otherEntry = try DomainFixture.entry(id: 12)
        let otherCheckIn = try CheckIn(
            id: DomainFixture.id(11), status: .completed, primaryArea: .neck,
            secondaryArea: nil, startedAt: DomainFixture.time,
            completedAt: DomainFixture.later, dayContext: DomainFixture.day,
            entries: [otherEntry]
        )
        let baseline = try DomainFixture.selectedDecision()
        let invalid = try SelectionDecision(
            id: baseline.id, checkInID: checkIn.id, revision: baseline.revision,
            rulesVersion: baseline.rulesVersion,
            catalogVersionRequested: baseline.catalogVersionRequested,
            catalogVersionDelivered: baseline.catalogVersionDelivered,
            outcome: baseline.outcome, recommendedLevel: baseline.recommendedLevel,
            requestedOverride: baseline.requestedOverride,
            overrideDisposition: baseline.overrideDisposition,
            selectedLevel: baseline.selectedLevel, deliveredLevel: baseline.deliveredLevel,
            durationVariant: baseline.durationVariant,
            secondaryOmissionReason: baseline.secondaryOmissionReason,
            validationResult: baseline.validationResult,
            primaryTemplateID: baseline.primaryTemplateID,
            primaryTemplateRevision: baseline.primaryTemplateRevision,
            secondaryModuleID: baseline.secondaryModuleID,
            secondaryModuleRevision: baseline.secondaryModuleRevision,
            compatibilityRuleID: baseline.compatibilityRuleID,
            compositionFingerprint: baseline.compositionFingerprint,
            createdAt: baseline.createdAt,
            areaInputs: [
                try DecisionAreaInput(
                    area: .neck, role: .primary, checkInEntryID: otherEntry.id,
                    baseLevel: .balanced, activeUnlocked: false,
                    qualifyingCount: 0, latestResponse: nil, included: true
                )
            ], reasons: [], notices: []
        )

        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil, checkIns: [checkIn, otherCheckIn], attentionStates: [],
                safetyEvents: [], pauseTodayEvents: [], decisions: [invalid],
                routineSessions: [], routineEvents: [], feedbackSubmissions: []
            )
        )
    }

    func testSnapshotRejectsImpossibleRoutineEventSequence() throws {
        let checkIn = try DomainFixture.checkIn()
        let decision = try DomainFixture.selectedDecision()
        let session = try DomainFixture.routineSession()
        let completedWithoutStart = try RoutineEvent(
            id: DomainFixture.id(9), routineSessionID: session.id, sequenceNumber: 1,
            kind: .completed, stepID: nil, moduleID: nil, alternativeID: nil,
            localReason: nil, occurredAt: DomainFixture.later
        )

        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil, checkIns: [checkIn], attentionStates: [],
                safetyEvents: [], pauseTodayEvents: [], decisions: [decision],
                routineSessions: [session], routineEvents: [completedWithoutStart],
                feedbackSubmissions: []
            )
        )
    }

    func testSnapshotRejectsTwoNonterminalRoutines() throws {
        let checkIn = try DomainFixture.checkIn()
        let decision = try DomainFixture.selectedDecision()
        let first = try DomainFixture.routineSession(status: .prepared, id: 6)
        let second = try RoutineSession(
            id: DomainFixture.id(7),
            decisionID: DomainFixture.id(8),
            checkInID: DomainFixture.id(9),
            status: .prepared,
            snapshot: DomainFixture.routineSnapshot(),
            currentStepIndex: 0,
            stepElapsedMilliseconds: 0,
            startedAt: nil,
            updatedAt: DomainFixture.later,
            endedAt: nil,
            dayContext: DomainFixture.day
        )
        XCTAssertThrowsError(
            try KineoDataSnapshot(
                profileState: nil,
                checkIns: [checkIn],
                attentionStates: [],
                safetyEvents: [],
                pauseTodayEvents: [],
                decisions: [decision],
                routineSessions: [first, second],
                routineEvents: [],
                feedbackSubmissions: []
            )
        )
    }
}
