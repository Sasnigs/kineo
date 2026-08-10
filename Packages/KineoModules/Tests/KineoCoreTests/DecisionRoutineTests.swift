import Foundation
import KineoCore
import XCTest

final class DecisionRoutineTests: XCTestCase {
    func testCanonicalJSONRequiresJSON() throws {
        XCTAssertNoThrow(try CanonicalJSON(bytes: Data("{}".utf8)))
        XCTAssertThrowsError(try CanonicalJSON(bytes: Data("not-json".utf8)))
    }

    func testDecisionAcceptsGentlerOverrideAndRejectsHigherSelection() throws {
        XCTAssertNoThrow(
            try DomainFixture.selectedDecision(
                requestedOverride: .gentle,
                disposition: .acceptedGentler,
                selected: .gentle,
                delivered: .gentle
            )
        )
        XCTAssertThrowsError(
            try DomainFixture.selectedDecision(
                recommended: .gentle,
                requestedOverride: .balanced,
                disposition: .acceptedGentler,
                selected: .balanced,
                delivered: .balanced
            )
        )
    }

    func testUnavailableDecisionRejectsDeliveredContentFields() throws {
        XCTAssertNoThrow(
            try SelectionDecision(
                id: DomainFixture.id(5),
                checkInID: DomainFixture.id(1),
                revision: 1,
                rulesVersion: DomainFixture.text("rules-v1"),
                catalogVersionRequested: DomainFixture.text("catalog-v1"),
                catalogVersionDelivered: nil,
                outcome: .contentUnavailable,
                recommendedLevel: .balanced,
                requestedOverride: nil,
                overrideDisposition: .none,
                selectedLevel: .balanced,
                deliveredLevel: nil,
                durationVariant: .standard,
                secondaryOmissionReason: .contentUnavailable,
                validationResult: .unavailable,
                primaryTemplateID: nil,
                primaryTemplateRevision: nil,
                secondaryModuleID: nil,
                secondaryModuleRevision: nil,
                compatibilityRuleID: nil,
                compositionFingerprint: nil,
                createdAt: DomainFixture.time,
                areaInputs: [DomainFixture.areaInput()],
                reasons: [],
                notices: []
            )
        )
        XCTAssertThrowsError(
            try SelectionDecision(
                id: DomainFixture.id(5),
                checkInID: DomainFixture.id(1),
                revision: 1,
                rulesVersion: DomainFixture.text("rules-v1"),
                catalogVersionRequested: DomainFixture.text("catalog-v1"),
                catalogVersionDelivered: DomainFixture.text("catalog-v1"),
                outcome: .contentUnavailable,
                recommendedLevel: .balanced,
                requestedOverride: nil,
                overrideDisposition: .none,
                selectedLevel: .balanced,
                deliveredLevel: nil,
                durationVariant: .standard,
                secondaryOmissionReason: nil,
                validationResult: .unavailable,
                primaryTemplateID: nil,
                primaryTemplateRevision: nil,
                secondaryModuleID: nil,
                secondaryModuleRevision: nil,
                compatibilityRuleID: nil,
                compositionFingerprint: nil,
                createdAt: DomainFixture.time,
                areaInputs: [DomainFixture.areaInput()],
                reasons: [],
                notices: []
            )
        )
    }

    func testDecisionRejectsNonpositiveContentRevision() throws {
        let baseline = try DomainFixture.selectedDecision()
        XCTAssertThrowsError(
            try SelectionDecision(
                id: baseline.id,
                checkInID: baseline.checkInID,
                revision: baseline.revision,
                rulesVersion: baseline.rulesVersion,
                catalogVersionRequested: baseline.catalogVersionRequested,
                catalogVersionDelivered: baseline.catalogVersionDelivered,
                outcome: baseline.outcome,
                recommendedLevel: baseline.recommendedLevel,
                requestedOverride: baseline.requestedOverride,
                overrideDisposition: baseline.overrideDisposition,
                selectedLevel: baseline.selectedLevel,
                deliveredLevel: baseline.deliveredLevel,
                durationVariant: baseline.durationVariant,
                secondaryOmissionReason: baseline.secondaryOmissionReason,
                validationResult: baseline.validationResult,
                primaryTemplateID: baseline.primaryTemplateID,
                primaryTemplateRevision: 0,
                secondaryModuleID: baseline.secondaryModuleID,
                secondaryModuleRevision: baseline.secondaryModuleRevision,
                compatibilityRuleID: baseline.compatibilityRuleID,
                compositionFingerprint: baseline.compositionFingerprint,
                createdAt: baseline.createdAt,
                areaInputs: baseline.areaInputs,
                reasons: baseline.reasons,
                notices: baseline.notices
            )
        )
    }

    func testDecisionRequiresOnePrimaryAndUniqueReasonPositions() throws {
        let secondary = try DecisionAreaInput(
            area: .lowerBack,
            role: .secondary,
            checkInEntryID: DomainFixture.id(3),
            baseLevel: .gentle,
            activeUnlocked: false,
            qualifyingCount: 0,
            latestResponse: nil,
            included: true
        )
        let parameters = try CanonicalJSON(bytes: Data("{}".utf8))
        let reason = try DecisionReason(
            kind: .selection,
            position: 0,
            code: DomainFixture.text("stable"),
            parameters: parameters
        )
        let baseline = try DomainFixture.selectedDecision()
        XCTAssertThrowsError(
            try SelectionDecision(
                id: baseline.id,
                checkInID: baseline.checkInID,
                revision: baseline.revision,
                rulesVersion: baseline.rulesVersion,
                catalogVersionRequested: baseline.catalogVersionRequested,
                catalogVersionDelivered: baseline.catalogVersionDelivered,
                outcome: baseline.outcome,
                recommendedLevel: baseline.recommendedLevel,
                requestedOverride: baseline.requestedOverride,
                overrideDisposition: baseline.overrideDisposition,
                selectedLevel: baseline.selectedLevel,
                deliveredLevel: baseline.deliveredLevel,
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
                areaInputs: [secondary],
                reasons: [reason, reason],
                notices: []
            )
        )
    }

    func testRoutineSnapshotRequiresDistinctIncludedAreas() {
        XCTAssertThrowsError(try DomainFixture.routineSnapshot(areas: []))
        XCTAssertThrowsError(try DomainFixture.routineSnapshot(areas: [.neck, .neck]))
        XCTAssertNoThrow(try DomainFixture.routineSnapshot(areas: [.neck, .lowerBack]))
    }

    func testRoutineSessionLifecycleTimesAreValidated() throws {
        XCTAssertNoThrow(try DomainFixture.routineSession(status: .prepared))
        XCTAssertNoThrow(try DomainFixture.routineSession(status: .paused))
        XCTAssertNoThrow(try DomainFixture.routineSession(status: .completed))
        XCTAssertThrowsError(
            try RoutineSession(
                id: DomainFixture.id(6),
                decisionID: DomainFixture.id(5),
                checkInID: DomainFixture.id(1),
                status: .completed,
                snapshot: DomainFixture.routineSnapshot(),
                currentStepIndex: 0,
                stepElapsedMilliseconds: 0,
                startedAt: nil,
                updatedAt: DomainFixture.later,
                endedAt: DomainFixture.later,
                dayContext: DomainFixture.day
            )
        )
    }

    func testRoutineEventShapesAndCheckpointAgreement() throws {
        let skipped = try RoutineEvent(
            id: DomainFixture.id(7),
            routineSessionID: DomainFixture.id(6),
            sequenceNumber: 2,
            kind: .skipped,
            stepID: DomainFixture.text("step-1"),
            moduleID: DomainFixture.text("primary"),
            alternativeID: nil,
            localReason: .uncomfortable,
            occurredAt: DomainFixture.time
        )
        let checkpoint = try RoutineCheckpoint(
            status: .inProgress,
            currentStepIndex: 1,
            stepElapsedMilliseconds: 0,
            updatedAt: DomainFixture.later,
            endedAt: nil
        )
        XCTAssertNoThrow(try RecordRoutineEventCommand(event: skipped, checkpoint: checkpoint))
        XCTAssertThrowsError(
            try RoutineEvent(
                id: DomainFixture.id(8),
                routineSessionID: DomainFixture.id(6),
                sequenceNumber: 3,
                kind: .alternativeSelected,
                stepID: DomainFixture.text("step-1"),
                moduleID: DomainFixture.text("primary"),
                alternativeID: nil,
                localReason: nil,
                occurredAt: DomainFixture.time
            )
        )
    }

    func testRoutineEventCheckpointCannotPrecedeEvent() throws {
        let event = try RoutineEvent(
            id: DomainFixture.id(9),
            routineSessionID: DomainFixture.id(6),
            sequenceNumber: 1,
            kind: .started,
            stepID: nil,
            moduleID: nil,
            alternativeID: nil,
            localReason: nil,
            occurredAt: DomainFixture.later
        )
        let earlyCheckpoint = try RoutineCheckpoint(
            status: .inProgress,
            currentStepIndex: 0,
            stepElapsedMilliseconds: 0,
            updatedAt: DomainFixture.time,
            endedAt: nil
        )

        XCTAssertThrowsError(
            try RecordRoutineEventCommand(event: event, checkpoint: earlyCheckpoint)
        )
        XCTAssertThrowsError(
            try RoutineCheckpoint(
                status: .completed,
                currentStepIndex: 1,
                stepElapsedMilliseconds: 0,
                updatedAt: DomainFixture.time,
                endedAt: DomainFixture.later
            )
        )
    }

    func testFeedbackSupportsPartialAndSkippedAllButRejectsDuplicates() throws {
        let response = FeedbackResponse(
            id: DomainFixture.id(20),
            area: .neck,
            response: .same
        )
        XCTAssertNoThrow(
            try FeedbackSubmission(
                id: DomainFixture.id(21),
                routineSessionID: DomainFixture.id(6),
                responses: [],
                submittedAt: DomainFixture.time,
                dayContext: DomainFixture.day
            )
        )
        XCTAssertThrowsError(
            try FeedbackSubmission(
                id: DomainFixture.id(21),
                routineSessionID: DomainFixture.id(6),
                responses: [response, response],
                submittedAt: DomainFixture.time,
                dayContext: DomainFixture.day
            )
        )
    }
}
