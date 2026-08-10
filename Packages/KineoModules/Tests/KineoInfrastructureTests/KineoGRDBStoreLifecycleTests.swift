@testable import KineoInfrastructure
import CryptoKit
import Foundation
import KineoCore
import XCTest

final class KineoGRDBStoreLifecycleTests: XCTestCase {
    func testGoldenLifecyclePersistsAcrossReopenThenResetsAndDeletes() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let graph = try await seedCompletedRoutine(in: store)

        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.profileState, graph.profile)
        XCTAssertEqual(saved.checkIns, [graph.checkIn])
        XCTAssertEqual(saved.decisions, [graph.decision])
        XCTAssertEqual(saved.routineSessions.count, 1)
        XCTAssertEqual(saved.routineSessions.first?.status, .completed)
        XCTAssertEqual(saved.routineEvents.count, 2)
        XCTAssertEqual(saved.feedbackSubmissions, [graph.feedback])

        try await store.closeForDeletion()
        let reopened = try await fixture.open()
        let reloaded = try await reopened.loadSnapshot()
        XCTAssertEqual(reloaded, saved)

        try await reopened.resetHistory()
        let reset = try await reopened.loadSnapshot()
        XCTAssertEqual(reset.profileState, graph.profile)
        XCTAssertTrue(reset.checkIns.isEmpty)
        XCTAssertTrue(reset.decisions.isEmpty)
        XCTAssertTrue(reset.routineSessions.isEmpty)
        XCTAssertTrue(reset.feedbackSubmissions.isEmpty)

        try await reopened.deleteAllData()
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.privateDirectoryURL.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.location.deletionMarkerURL.path))
    }

    func testTransactionFailureRollsBackProfileWrite() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open(
            failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("saveProfile")])
        )
        let state = try makeProfile()

        await assertThrows {
            try await store.saveProfile(SaveProfileCommand(state: state))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .writeFailed)
        }
        let snapshot = try await store.loadSnapshot()
        XCTAssertNil(snapshot.profileState)
        XCTAssertTrue(snapshot.checkIns.isEmpty)
    }

    func testResetRetainsOnlyCurrentAttentionAndProfile() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let profile = try makeProfile()
        try await store.saveProfile(SaveProfileCommand(state: profile))

        let entry = try CheckInEntry(
            id: try CheckInEntryID(validating: uuid(21)), area: .neck, role: .primary,
            changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .yes,
            submittedAt: time(20)
        )
        let checkIn = try makeCheckIn(id: 20, entry: entry)
        let event = try SafetyEvent(
            id: try SafetyEventID(validating: uuid(22)), area: .neck,
            kind: .attentionEntered, sourceCheckInEntryID: entry.id,
            occurredAt: time(21), dayContext: day
        )
        let mutation = try SafetyMutation(event: event, statusAfter: .attentionRequired)
        try await store.completeCheckIn(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [mutation])
        )

        try await store.resetHistory()
        let snapshot = try await store.loadSnapshot()
        XCTAssertEqual(snapshot.profileState, profile)
        XCTAssertEqual(snapshot.attentionStates, [AttentionState(area: .neck, updatedAt: time(21))])
        XCTAssertTrue(snapshot.checkIns.isEmpty)
        XCTAssertTrue(snapshot.safetyEvents.isEmpty)
    }

    func testCorrectionRequiresCompletedTriggerAndCurrentAttention() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let sourceEntry = try CheckInEntry(
            id: try CheckInEntryID(validating: uuid(31)), area: .neck, role: .primary,
            changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(30)
        )
        let source = try makeCheckIn(id: 30, entry: sourceEntry)
        try await store.completeCheckIn(
            try CompleteCheckInCommand(checkIn: source, safetyMutations: [])
        )
        let correction = try CheckIn(
            id: try CheckInID(validating: uuid(32)), status: .draft,
            kind: .attentionCorrection,
            correctionSource: CorrectionSource(area: .neck, triggeringEntryID: sourceEntry.id),
            primaryArea: .neck, secondaryArea: nil, startedAt: time(31), completedAt: nil,
            dayContext: day, entries: []
        )

        await assertThrows {
            try await store.saveCheckInDraft(try SaveCheckInDraftCommand(checkIn: correction))
        } verify: { error in
            XCTAssertEqual(
                error as? KineoCore.PersistenceError,
                .constraintViolation(.domainInvariant)
            )
        }
    }

    func testFeedbackRetryRejectsMutatedPayload() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let graph = try await seedCompletedRoutine(in: store)
        let changed = try FeedbackSubmission(
            id: graph.feedback.id,
            routineSessionID: graph.feedback.routineSessionID,
            responses: [
                FeedbackResponse(
                    id: graph.feedback.responses[0].id,
                    area: .neck,
                    response: .worse
                )
            ],
            submittedAt: graph.feedback.submittedAt,
            dayContext: graph.feedback.dayContext
        )

        await assertThrows {
            try await store.submitFeedback(SubmitFeedbackCommand(submission: changed))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
    }

    func testRoutineEventRetryRejectsChangedCheckpoint() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let seeded = try await seedPreparedRoutine(in: store)
        let startedEvent = try RoutineEvent(
            id: try RoutineEventID(validating: uuid(51)), routineSessionID: seeded.session.id,
            sequenceNumber: 1, kind: .started, stepID: nil, moduleID: nil,
            alternativeID: nil, localReason: nil, occurredAt: time(70)
        )
        let checkpoint = try RoutineCheckpoint(
            status: .inProgress, currentStepIndex: 0, stepElapsedMilliseconds: 0,
            updatedAt: time(70), endedAt: nil
        )
        try await store.recordRoutineEvent(
            try RecordRoutineEventCommand(event: startedEvent, checkpoint: checkpoint)
        )
        let changedCheckpoint = try RoutineCheckpoint(
            status: .inProgress, currentStepIndex: 1, stepElapsedMilliseconds: 0,
            updatedAt: time(70), endedAt: nil
        )

        await assertThrows {
            try await store.recordRoutineEvent(
                try RecordRoutineEventCommand(event: startedEvent, checkpoint: changedCheckpoint)
            )
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
    }

    func testRoutineEventRejectsTimeBeforeDurableCheckpointWithoutCorruptingStore() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let seeded = try await seedPreparedRoutine(in: store)
        let staleEvent = try RoutineEvent(
            id: try RoutineEventID(validating: uuid(52)), routineSessionID: seeded.session.id,
            sequenceNumber: 1, kind: .started, stepID: nil, moduleID: nil,
            alternativeID: nil, localReason: nil, occurredAt: time(61)
        )
        let checkpoint = try RoutineCheckpoint(
            status: .inProgress, currentStepIndex: 0, stepElapsedMilliseconds: 0,
            updatedAt: time(61), endedAt: nil
        )

        await assertThrows {
            try await store.recordRoutineEvent(
                try RecordRoutineEventCommand(event: staleEvent, checkpoint: checkpoint)
            )
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .invalidLifecycleTransition)
        }
        let snapshot = try await store.loadSnapshot()
        XCTAssertEqual(snapshot.routineSessions.first?.status, .prepared)
        XCTAssertTrue(snapshot.routineEvents.isEmpty)
    }

    func testResetAttentionCanBeClearedBySourceLessCorrection() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let trigger = try CheckInEntry(
            id: try CheckInEntryID(validating: uuid(81)), area: .neck, role: .primary,
            changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .yes,
            submittedAt: time(80)
        )
        let blocked = try makeCheckIn(id: 80, entry: trigger)
        let entered = try SafetyEvent(
            id: try SafetyEventID(validating: uuid(82)), area: .neck,
            kind: .attentionEntered, sourceCheckInEntryID: trigger.id,
            occurredAt: time(81), dayContext: day
        )
        try await store.completeCheckIn(
            try CompleteCheckInCommand(
                checkIn: blocked,
                safetyMutations: [SafetyMutation(event: entered, statusAfter: .attentionRequired)]
            )
        )
        try await store.resetHistory()

        let correctedEntry = try CheckInEntry(
            id: try CheckInEntryID(validating: uuid(83)), area: .neck, role: .primary,
            changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(82)
        )
        let correction = try CheckIn(
            id: try CheckInID(validating: uuid(84)), status: .completed,
            kind: .attentionCorrection,
            correctionSource: CorrectionSource(area: .neck, triggeringEntryID: nil),
            primaryArea: .neck, secondaryArea: nil, startedAt: time(82),
            completedAt: time(83), dayContext: day, entries: [correctedEntry]
        )
        let cleared = try SafetyEvent(
            id: try SafetyEventID(validating: uuid(85)), area: .neck,
            kind: .attentionClearedCorrection, sourceCheckInEntryID: correctedEntry.id,
            occurredAt: time(83), dayContext: day
        )
        try await store.completeCheckIn(
            try CompleteCheckInCommand(
                checkIn: correction,
                safetyMutations: [
                    SafetyMutation(
                        event: cleared,
                        statusAfter: .normal,
                        expectedAttentionUpdatedAt: time(81)
                    )
                ]
            )
        )

        let snapshot = try await store.loadSnapshot()
        XCTAssertTrue(snapshot.attentionStates.isEmpty)
        XCTAssertEqual(snapshot.checkIns, [correction])
        XCTAssertEqual(snapshot.safetyEvents, [cleared])
    }

    func testBlockedCheckInCannotGainDecisionAfterAttentionClears() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        try await store.saveProfile(SaveProfileCommand(state: makeProfile()))
        let trigger = try CheckInEntry(
            id: try CheckInEntryID(validating: uuid(91)), area: .neck, role: .primary,
            changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .yes,
            submittedAt: time(90)
        )
        let blocked = try makeCheckIn(id: 90, entry: trigger)
        let entered = try SafetyEvent(
            id: try SafetyEventID(validating: uuid(92)), area: .neck,
            kind: .attentionEntered, sourceCheckInEntryID: trigger.id,
            occurredAt: time(91), dayContext: day
        )
        try await store.completeCheckIn(
            try CompleteCheckInCommand(
                checkIn: blocked,
                safetyMutations: [SafetyMutation(event: entered, statusAfter: .attentionRequired)]
            )
        )
        let returned = try SafetyEvent(
            id: try SafetyEventID(validating: uuid(93)), area: .neck,
            kind: .attentionClearedReturnedToUsual, sourceCheckInEntryID: nil,
            returnAnswer: .yes, occurredAt: time(92), dayContext: day
        )
        try await store.applySafetyMutation(
            try ApplySafetyMutationCommand(
                mutation: SafetyMutation(
                    event: returned,
                    statusAfter: .normal,
                    expectedAttentionUpdatedAt: time(91)
                )
            )
        )
        let decision = try makeDecision(id: 94, checkIn: blocked, entries: [trigger], level: .gentle)

        await assertThrows {
            try await store.appendDecision(AppendDecisionCommand(decision: decision))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
    }

    func testEligiblePauseTodayRoundTripsAndRejectsMutatedRetry() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        try await store.saveProfile(SaveProfileCommand(state: makeProfile()))
        let entry = try CheckInEntry(
            id: try CheckInEntryID(validating: uuid(101)), area: .neck, role: .primary,
            changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .no,
            submittedAt: time(100)
        )
        let checkIn = try makeCheckIn(id: 100, entry: entry)
        try await store.completeCheckIn(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
        )
        let decision = try makeDecision(id: 102, checkIn: checkIn, entries: [entry], level: .gentle)
        try await store.appendDecision(AppendDecisionCommand(decision: decision))
        let event = PauseTodayEvent(
            id: try PauseTodayEventID(validating: uuid(103)), checkInID: checkIn.id,
            chosenAt: time(102), dayContext: day
        )
        try await store.recordPauseToday(RecordPauseTodayCommand(event: event))
        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.pauseTodayEvents, [event])

        let changed = PauseTodayEvent(
            id: event.id, checkInID: event.checkInID, chosenAt: time(103), dayContext: day
        )
        await assertThrows {
            try await store.recordPauseToday(RecordPauseTodayCommand(event: changed))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
    }

    func testDecisionAllowsProfileSecondarySkippedBeforeCheckIn() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let profile = try UserProfile(
            onboardingCompletedAt: time(2), adultAcknowledged: true,
            safetyBoundaryVersion: NonEmptyString(validating: "safety-v1"),
            safetyAcknowledgedAt: time(2), primaryArea: .neck, secondaryArea: .lowerBack,
            routinePreference: nil, createdAt: time(1), updatedAt: time(2)
        )
        try await store.saveProfile(
            SaveProfileCommand(state: ProfileState(profile: profile, reminderSettings: nil))
        )
        let entry = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(181)), area: .neck, role: .primary,
            changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(181)
        )
        let checkIn = try makeCheckIn(id: 180, entry: entry)
        try await store.completeCheckIn(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
        )
        let silentDecision = try makeDecision(
            id: 182, checkIn: checkIn, entries: [entry], level: .balanced
        )

        await assertThrows {
            try await store.appendDecision(AppendDecisionCommand(decision: silentDecision))
        } verify: { error in
            XCTAssertEqual(
                error as? KineoCore.PersistenceError,
                .constraintViolation(.domainInvariant)
            )
        }
        let skipNotice = try DecisionNotice(
            position: 0,
            code: NonEmptyString(validating: "notice.secondary_skipped"),
            area: .lowerBack,
            parameters: CanonicalJSON(bytes: Data("{}".utf8))
        )
        let decision = try makeDecision(
            id: 183,
            checkIn: checkIn,
            entries: [entry],
            level: .balanced,
            omissionReason: .secondaryUnanswered,
            notices: [skipNotice]
        )

        try await store.appendDecision(AppendDecisionCommand(decision: decision))

        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.decisions, [decision])
    }

    func testDecisionAuditMustIncludeEveryCompletedCheckInEntry() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let profile = try UserProfile(
            onboardingCompletedAt: time(2), adultAcknowledged: true,
            safetyBoundaryVersion: NonEmptyString(validating: "safety-v1"),
            safetyAcknowledgedAt: time(2), primaryArea: .neck, secondaryArea: .lowerBack,
            routinePreference: nil, createdAt: time(1), updatedAt: time(2)
        )
        try await store.saveProfile(
            SaveProfileCommand(state: ProfileState(profile: profile, reminderSettings: nil))
        )
        let primary = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(191)), area: .neck, role: .primary,
            changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(191)
        )
        let secondary = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(192)), area: .lowerBack, role: .secondary,
            changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(191)
        )
        let checkIn = try CheckIn(
            id: CheckInID(validating: uuid(190)), status: .completed,
            primaryArea: .neck, secondaryArea: .lowerBack, startedAt: time(190),
            completedAt: time(191), dayContext: day, entries: [primary, secondary]
        )
        try await store.completeCheckIn(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
        )
        let incompleteAudit = try makeDecision(
            id: 193, checkIn: checkIn, entries: [primary], level: .balanced
        )

        await assertThrows {
            try await store.appendDecision(AppendDecisionCommand(decision: incompleteAudit))
        } verify: { error in
            XCTAssertEqual(
                error as? KineoCore.PersistenceError,
                .constraintViolation(.domainInvariant)
            )
        }
    }

    func testStaleSafetyMutationCannotClearNewerAttentionState() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let entry = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(201)), area: .neck, role: .primary,
            changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .yes,
            submittedAt: time(200)
        )
        let checkIn = try makeCheckIn(id: 200, entry: entry)
        let entered = try SafetyEvent(
            id: SafetyEventID(validating: uuid(202)), area: .neck,
            kind: .attentionEntered, sourceCheckInEntryID: entry.id,
            occurredAt: time(201), dayContext: day
        )
        try await store.completeCheckIn(
            try CompleteCheckInCommand(
                checkIn: checkIn,
                safetyMutations: [SafetyMutation(event: entered, statusAfter: .attentionRequired)]
            )
        )
        let reaffirmed = try SafetyEvent(
            id: SafetyEventID(validating: uuid(203)), area: .neck,
            kind: .attentionReaffirmed, sourceCheckInEntryID: nil, returnAnswer: .no,
            occurredAt: time(202), dayContext: day
        )
        try await store.applySafetyMutation(
            try ApplySafetyMutationCommand(
                mutation: SafetyMutation(
                    event: reaffirmed,
                    statusAfter: .attentionRequired,
                    expectedAttentionUpdatedAt: time(201)
                )
            )
        )
        let staleClear = try SafetyEvent(
            id: SafetyEventID(validating: uuid(204)), area: .neck,
            kind: .attentionClearedReturnedToUsual, sourceCheckInEntryID: nil,
            returnAnswer: .yes, occurredAt: time(203), dayContext: day
        )

        await assertThrows {
            try await store.applySafetyMutation(
                try ApplySafetyMutationCommand(
                    mutation: SafetyMutation(
                        event: staleClear,
                        statusAfter: .normal,
                        expectedAttentionUpdatedAt: time(201)
                    )
                )
            )
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.attentionStates, [AttentionState(area: .neck, updatedAt: time(202))])
        XCTAssertEqual(saved.safetyEvents, [entered, reaffirmed])
    }

    func testFeedbackCannotPrecedeRoutineEnd() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let prepared = try await seedPreparedRoutine(in: store)
        try await finishRoutine(prepared.session, in: store, idBase: 210)
        let submission = try FeedbackSubmission(
            id: FeedbackSubmissionID(validating: uuid(212)),
            routineSessionID: prepared.session.id,
            responses: [], submittedAt: time(210), dayContext: day
        )

        await assertThrows {
            try await store.submitFeedback(SubmitFeedbackCommand(submission: submission))
        } verify: { error in
            XCTAssertEqual(
                error as? KineoCore.PersistenceError,
                .constraintViolation(.domainInvariant)
            )
        }
    }

    func testAbandonedRoutineCannotReceiveFeedback() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let prepared = try await seedPreparedRoutine(in: store)
        let abandoned = try RoutineEvent(
            id: RoutineEventID(validating: uuid(231)), routineSessionID: prepared.session.id,
            sequenceNumber: 1, kind: .abandoned, stepID: nil, moduleID: nil,
            alternativeID: nil, localReason: nil, occurredAt: time(230)
        )
        try await store.recordRoutineEvent(
            try RecordRoutineEventCommand(
                event: abandoned,
                checkpoint: RoutineCheckpoint(
                    status: .abandoned, currentStepIndex: 0, stepElapsedMilliseconds: 0,
                    updatedAt: time(230), endedAt: time(230)
                )
            )
        )
        let submission = try FeedbackSubmission(
            id: FeedbackSubmissionID(validating: uuid(232)),
            routineSessionID: prepared.session.id,
            responses: [], submittedAt: time(231), dayContext: day
        )

        await assertThrows {
            try await store.submitFeedback(SubmitFeedbackCommand(submission: submission))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
    }

    func testRoutineSnapshotAreasMustMatchIncludedDecisionInputs() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let prepared = try await seedPreparedRoutine(in: store)
        _ = try await store.transaction(name: "remove-routine-for-area-mismatch") { db in
            try db.execute(
                sql: "DELETE FROM routine_sessions WHERE id = ?",
                arguments: [prepared.session.id.rawValue]
            )
            return true
        }
        let bytes = Data(#"{"includedAreas":["lowerBack"]}"#.utf8)
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let mismatched = try RoutineSession(
            id: prepared.session.id, decisionID: prepared.session.decisionID,
            checkInID: prepared.session.checkInID, status: .prepared,
            snapshot: OpaqueRoutineSnapshot(
                bytes: bytes,
                checksum: SHA256Digest(validating: hash),
                includedAreas: [.lowerBack]
            ),
            currentStepIndex: 0, stepElapsedMilliseconds: 0, startedAt: nil,
            updatedAt: time(62), endedAt: nil, dayContext: day
        )

        await assertThrows {
            try await store.createRoutine(try CreateRoutineCommand(session: mismatched))
        } verify: { error in
            XCTAssertEqual(
                error as? KineoCore.PersistenceError,
                .constraintViolation(.domainInvariant)
            )
        }
    }

    func testDeletionPendingBlocksFurtherReadsAndWrites() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open(
            failure: KineoStoreFailureInjection(points: [.deletionAfterMarker])
        )
        await assertThrows {
            try await store.deleteAllData()
        } verify: { _ in }

        await assertThrows {
            _ = try await store.loadSnapshot()
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .storeDeleted)
        }
        await assertThrows {
            try await store.saveProfile(SaveProfileCommand(state: makeProfile()))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .storeDeleted)
        }
    }

    func testMultiRecordCommandsRollBackAtCommitBoundary() async throws {
        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("saveCheckInDraft")])
            )
            let entry = try CheckInEntry(
                id: CheckInEntryID(validating: uuid(105)), area: .neck, role: .primary,
                changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
                submittedAt: time(105)
            )
            let draft = try CheckIn(
                id: CheckInID(validating: uuid(104)), status: .draft,
                primaryArea: .neck, secondaryArea: nil, startedAt: time(104),
                completedAt: nil, dayContext: day, entries: [entry]
            )
            await assertThrows {
                try await store.saveCheckInDraft(try SaveCheckInDraftCommand(checkIn: draft))
            } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertTrue(after.checkIns.isEmpty)
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("completeCheckIn")])
            )
            let entry = try CheckInEntry(
                id: try CheckInEntryID(validating: uuid(111)), area: .neck, role: .primary,
                changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .yes,
                submittedAt: time(110)
            )
            let checkIn = try makeCheckIn(id: 110, entry: entry)
            let event = try SafetyEvent(
                id: try SafetyEventID(validating: uuid(112)), area: .neck,
                kind: .attentionEntered, sourceCheckInEntryID: entry.id,
                occurredAt: time(111), dayContext: day
            )
            await assertThrows {
                try await store.completeCheckIn(
                    try CompleteCheckInCommand(
                        checkIn: checkIn,
                        safetyMutations: [SafetyMutation(event: event, statusAfter: .attentionRequired)]
                    )
                )
            } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertTrue(after.checkIns.isEmpty)
            XCTAssertTrue(after.safetyEvents.isEmpty)
            XCTAssertTrue(after.attentionStates.isEmpty)
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("applySafetyMutation")])
            )
            let entry = try CheckInEntry(
                id: CheckInEntryID(validating: uuid(115)), area: .neck, role: .primary,
                changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .yes,
                submittedAt: time(115)
            )
            let checkIn = try makeCheckIn(id: 114, entry: entry)
            let entered = try SafetyEvent(
                id: SafetyEventID(validating: uuid(116)), area: .neck,
                kind: .attentionEntered, sourceCheckInEntryID: entry.id,
                occurredAt: time(116), dayContext: day
            )
            try await store.completeCheckIn(
                try CompleteCheckInCommand(
                    checkIn: checkIn,
                    safetyMutations: [SafetyMutation(event: entered, statusAfter: .attentionRequired)]
                )
            )
            let returned = try SafetyEvent(
                id: SafetyEventID(validating: uuid(117)), area: .neck,
                kind: .attentionClearedReturnedToUsual, sourceCheckInEntryID: nil,
                returnAnswer: .yes, occurredAt: time(117), dayContext: day
            )
            await assertThrows {
                try await store.applySafetyMutation(
                    try ApplySafetyMutationCommand(
                        mutation: SafetyMutation(
                            event: returned,
                            statusAfter: .normal,
                            expectedAttentionUpdatedAt: time(116)
                        )
                    )
                )
            } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertEqual(after.attentionStates.map(\.area), [.neck])
            XCTAssertEqual(after.safetyEvents, [entered])
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("appendDecision")])
            )
            try await store.saveProfile(SaveProfileCommand(state: makeProfile()))
            let entry = try CheckInEntry(
                id: try CheckInEntryID(validating: uuid(121)), area: .neck, role: .primary,
                changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
                submittedAt: time(120)
            )
            let checkIn = try makeCheckIn(id: 120, entry: entry)
            try await store.completeCheckIn(
                try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
            )
            let decision = try makeDecision(id: 122, checkIn: checkIn, entries: [entry], level: .balanced)
            await assertThrows {
                try await store.appendDecision(AppendDecisionCommand(decision: decision))
            } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertTrue(after.decisions.isEmpty)
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("recordRoutineEvent")])
            )
            let prepared = try await seedPreparedRoutine(in: store)
            let event = try RoutineEvent(
                id: try RoutineEventID(validating: uuid(131)), routineSessionID: prepared.session.id,
                sequenceNumber: 1, kind: .started, stepID: nil, moduleID: nil,
                alternativeID: nil, localReason: nil, occurredAt: time(130)
            )
            let checkpoint = try RoutineCheckpoint(
                status: .inProgress, currentStepIndex: 0, stepElapsedMilliseconds: 0,
                updatedAt: time(130), endedAt: nil
            )
            await assertThrows {
                try await store.recordRoutineEvent(
                    try RecordRoutineEventCommand(event: event, checkpoint: checkpoint)
                )
            } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertEqual(after.routineSessions.first?.status, .prepared)
            XCTAssertTrue(after.routineEvents.isEmpty)
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("submitFeedback")])
            )
            let prepared = try await seedPreparedRoutine(in: store)
            try await finishRoutine(prepared.session, in: store, idBase: 140)
            let submission = try FeedbackSubmission(
                id: try FeedbackSubmissionID(validating: uuid(143)),
                routineSessionID: prepared.session.id,
                responses: [
                    FeedbackResponse(
                        id: try AreaFeedbackID(validating: uuid(144)), area: .neck, response: .same
                    )
                ],
                submittedAt: time(143), dayContext: day
            )
            await assertThrows {
                try await store.submitFeedback(SubmitFeedbackCommand(submission: submission))
            } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertTrue(after.feedbackSubmissions.isEmpty)
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open(
                failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("resetHistory")])
            )
            _ = try await seedCompletedRoutine(in: store)
            let before = try await store.loadSnapshot()
            await assertThrows { try await store.resetHistory() } verify: { _ in }
            let after = try await store.loadSnapshot()
            XCTAssertEqual(after, before)
        }
    }

    func testPauseTodayRollsBackAtCommitBoundary() async throws {
        let fixture = LifecycleFixture()
        let setup = try await fixture.open()
        try await setup.saveProfile(SaveProfileCommand(state: makeProfile()))
        let entry = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(221)), area: .neck, role: .primary,
            changeReport: .worse, movementComfort: .good, conditionalSafetyAnswer: .no,
            submittedAt: time(220)
        )
        let checkIn = try makeCheckIn(id: 220, entry: entry)
        try await setup.completeCheckIn(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
        )
        let decision = try makeDecision(id: 222, checkIn: checkIn, entries: [entry], level: .gentle)
        try await setup.appendDecision(AppendDecisionCommand(decision: decision))
        try await setup.closeForDeletion()
        let store = try await fixture.open(
            failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("recordPauseToday")])
        )
        let event = PauseTodayEvent(
            id: try PauseTodayEventID(validating: uuid(223)), checkInID: checkIn.id,
            chosenAt: time(223), dayContext: day
        )

        await assertThrows {
            try await store.recordPauseToday(RecordPauseTodayCommand(event: event))
        } verify: { _ in }
        let saved = try await store.loadSnapshot()
        XCTAssertTrue(saved.pauseTodayEvents.isEmpty)
    }

    func testPreparedRoutineCreationRollsBackAtCommitBoundary() async throws {
        let fixture = LifecycleFixture()
        let setup = try await fixture.open()
        let prepared = try await seedPreparedRoutine(in: setup)
        _ = try await setup.transaction(name: "remove-prepared-routine") { db in
            try db.execute(
                sql: "DELETE FROM routine_sessions WHERE id = ?",
                arguments: [prepared.session.id.rawValue]
            )
            return true
        }
        try await setup.closeForDeletion()
        let store = try await fixture.open(
            failure: KineoStoreFailureInjection(points: [.transactionBeforeCommit("createRoutine")])
        )

        await assertThrows {
            try await store.createRoutine(try CreateRoutineCommand(session: prepared.session))
        } verify: { _ in }
        let saved = try await store.loadSnapshot()
        XCTAssertTrue(saved.routineSessions.isEmpty)
    }

    func testTwoAreaDecisionReasonsAndNoticesRoundTrip() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let profile = try UserProfile(
            onboardingCompletedAt: time(2), adultAcknowledged: true,
            safetyBoundaryVersion: NonEmptyString(validating: "safety-v1"),
            safetyAcknowledgedAt: time(2), primaryArea: .neck, secondaryArea: .lowerBack,
            routinePreference: nil, createdAt: time(1), updatedAt: time(2)
        )
        try await store.saveProfile(
            SaveProfileCommand(state: ProfileState(profile: profile, reminderSettings: nil))
        )
        let primary = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(151)), area: .neck, role: .primary,
            changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(150)
        )
        let secondary = try CheckInEntry(
            id: CheckInEntryID(validating: uuid(152)), area: .lowerBack, role: .secondary,
            changeReport: .better, movementComfort: .good, conditionalSafetyAnswer: nil,
            submittedAt: time(150)
        )
        let checkIn = try CheckIn(
            id: CheckInID(validating: uuid(150)), status: .completed,
            primaryArea: .neck, secondaryArea: .lowerBack, startedAt: time(150),
            completedAt: time(151), dayContext: day, entries: [primary, secondary]
        )
        try await store.completeCheckIn(
            try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
        )
        let parameters = try CanonicalJSON(bytes: Data("{}".utf8))
        let reason = try DecisionReason(
            kind: .selection, position: 0,
            code: NonEmptyString(validating: "minimumAreaLevel"), parameters: parameters
        )
        let notice = try DecisionNotice(
            position: 0, code: NonEmptyString(validating: "twoAreasIncluded"),
            area: .lowerBack, parameters: parameters
        )
        let base = try makeDecision(
            id: 153, checkIn: checkIn, entries: [primary, secondary], level: .balanced
        )
        let decision = try SelectionDecision(
            id: base.id, checkInID: base.checkInID, revision: base.revision,
            rulesVersion: base.rulesVersion,
            catalogVersionRequested: base.catalogVersionRequested,
            catalogVersionDelivered: base.catalogVersionDelivered, outcome: base.outcome,
            recommendedLevel: base.recommendedLevel, requestedOverride: base.requestedOverride,
            overrideDisposition: base.overrideDisposition, selectedLevel: base.selectedLevel,
            deliveredLevel: base.deliveredLevel, durationVariant: base.durationVariant,
            secondaryOmissionReason: base.secondaryOmissionReason,
            validationResult: base.validationResult, primaryTemplateID: base.primaryTemplateID,
            primaryTemplateRevision: base.primaryTemplateRevision,
            secondaryModuleID: base.secondaryModuleID,
            secondaryModuleRevision: base.secondaryModuleRevision,
            compatibilityRuleID: base.compatibilityRuleID,
            compositionFingerprint: base.compositionFingerprint, createdAt: base.createdAt,
            areaInputs: base.areaInputs, reasons: [reason], notices: [notice]
        )
        try await store.appendDecision(AppendDecisionCommand(decision: decision))

        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.checkIns, [checkIn])
        XCTAssertEqual(saved.decisions, [decision])
    }

    func testSkippedAllFeedbackRoundTrips() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let prepared = try await seedPreparedRoutine(in: store)
        try await finishRoutine(prepared.session, in: store, idBase: 160)
        let submission = try FeedbackSubmission(
            id: FeedbackSubmissionID(validating: uuid(162)),
            routineSessionID: prepared.session.id, responses: [],
            submittedAt: time(162), dayContext: day
        )
        try await store.submitFeedback(SubmitFeedbackCommand(submission: submission))

        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.feedbackSubmissions, [submission])
    }

    func testReloadRejectsMutatedRoutineAndFeedbackAuditFields() async throws {
        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open()
            _ = try await seedCompletedRoutine(in: store)
            _ = try await store.transaction(name: "corrupt-routine-audit") { db in
                try db.execute(
                    sql: "UPDATE routine_events SET resulting_step_index = 99 WHERE sequence_number = 2"
                )
                return true
            }
            await assertThrows {
                _ = try await store.loadSnapshot()
            } verify: { error in
                XCTAssertEqual(error as? KineoCore.PersistenceError, .corruptedStore)
            }
        }

        do {
            let fixture = LifecycleFixture()
            let store = try await fixture.open()
            _ = try await seedCompletedRoutine(in: store)
            _ = try await store.transaction(name: "corrupt-feedback-audit") { db in
                try db.execute(sql: "UPDATE area_feedback SET submitted_at_ms = submitted_at_ms + 1")
                return true
            }
            await assertThrows {
                _ = try await store.loadSnapshot()
            } verify: { error in
                XCTAssertEqual(error as? KineoCore.PersistenceError, .corruptedStore)
            }
        }
    }

    func testProfileCreationTimestampIsImmutable() async throws {
        let fixture = LifecycleFixture()
        let store = try await fixture.open()
        let original = try makeProfile()
        try await store.saveProfile(SaveProfileCommand(state: original))
        let changedProfile = try UserProfile(
            onboardingCompletedAt: original.profile.onboardingCompletedAt,
            adultAcknowledged: original.profile.adultAcknowledged,
            safetyBoundaryVersion: original.profile.safetyBoundaryVersion,
            safetyAcknowledgedAt: original.profile.safetyAcknowledgedAt,
            primaryArea: original.profile.primaryArea,
            secondaryArea: original.profile.secondaryArea,
            routinePreference: original.profile.routinePreference,
            weeklyGoalDays: original.profile.weeklyGoalDays,
            telemetryChoice: original.profile.telemetryChoice,
            createdAt: time(0), updatedAt: time(3)
        )
        await assertThrows {
            try await store.saveProfile(
                SaveProfileCommand(
                    state: ProfileState(
                        profile: changedProfile,
                        reminderSettings: original.reminderSettings
                    )
                )
            )
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .conflictingWrite)
        }
        let saved = try await store.loadSnapshot()
        XCTAssertEqual(saved.profileState, original)
    }

    func testPostCommitProtectionFailureHasDistinctRecoveryError() async throws {
        let fixture = LifecycleFixture()
        let protector = ArmableStorageProtector()
        let store = try await KineoGRDBStore.open(
            location: fixture.location,
            storageProtector: protector
        )
        let profile = try makeProfile()
        protector.arm()
        await assertThrows {
            try await store.saveProfile(SaveProfileCommand(state: profile))
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .storageProtectionFailed)
        }
        protector.disarm()
        await assertThrows {
            _ = try await store.loadSnapshot()
        } verify: { error in
            XCTAssertEqual(error as? KineoCore.PersistenceError, .storageProtectionFailed)
        }
        let reopened = try await KineoGRDBStore.open(
            location: fixture.location,
            storageProtector: protector
        )
        let saved = try await reopened.loadSnapshot()
        XCTAssertEqual(saved.profileState, profile)
    }
}

private struct SeededGraph {
    let profile: ProfileState
    let checkIn: CheckIn
    let decision: SelectionDecision
    let feedback: FeedbackSubmission
}

private struct PreparedGraph {
    let session: RoutineSession
}

private func seedCompletedRoutine(in store: KineoGRDBStore) async throws -> SeededGraph {
    let prepared = try await seedPreparedRoutine(in: store)
    let started = try RoutineEvent(
        id: try RoutineEventID(validating: uuid(71)), routineSessionID: prepared.session.id,
        sequenceNumber: 1, kind: .started, stepID: nil, moduleID: nil,
        alternativeID: nil, localReason: nil, occurredAt: time(70)
    )
    try await store.recordRoutineEvent(
        try RecordRoutineEventCommand(
            event: started,
            checkpoint: RoutineCheckpoint(
                status: .inProgress, currentStepIndex: 0, stepElapsedMilliseconds: 0,
                updatedAt: time(70), endedAt: nil
            )
        )
    )
    let completed = try RoutineEvent(
        id: try RoutineEventID(validating: uuid(72)), routineSessionID: prepared.session.id,
        sequenceNumber: 2, kind: .completed, stepID: nil, moduleID: nil,
        alternativeID: nil, localReason: nil, occurredAt: time(71)
    )
    try await store.recordRoutineEvent(
        try RecordRoutineEventCommand(
            event: completed,
            checkpoint: RoutineCheckpoint(
                status: .completed, currentStepIndex: 1, stepElapsedMilliseconds: 0,
                updatedAt: time(71), endedAt: time(71)
            )
        )
    )
    let feedback = try FeedbackSubmission(
        id: try FeedbackSubmissionID(validating: uuid(73)),
        routineSessionID: prepared.session.id,
        responses: [
            FeedbackResponse(
                id: try AreaFeedbackID(validating: uuid(74)), area: .neck, response: .same
            )
        ],
        submittedAt: time(72), dayContext: day
    )
    try await store.submitFeedback(SubmitFeedbackCommand(submission: feedback))
    let snapshot = try await store.loadSnapshot()
    return SeededGraph(
        profile: snapshot.profileState!, checkIn: snapshot.checkIns[0],
        decision: snapshot.decisions[0], feedback: feedback
    )
}

private func seedPreparedRoutine(in store: KineoGRDBStore) async throws -> PreparedGraph {
    let profile = try makeProfile()
    try await store.saveProfile(SaveProfileCommand(state: profile))
    let entry = try CheckInEntry(
        id: try CheckInEntryID(validating: uuid(61)), area: .neck, role: .primary,
        changeReport: .similar, movementComfort: .good, conditionalSafetyAnswer: nil,
        submittedAt: time(60)
    )
    let checkIn = try makeCheckIn(id: 60, entry: entry)
    try await store.completeCheckIn(
        try CompleteCheckInCommand(checkIn: checkIn, safetyMutations: [])
    )
    let json = Data(#"{"includedAreas":["neck"]}"#.utf8)
    let hash = SHA256.hash(data: json).map { String(format: "%02x", $0) }.joined()
    let digest = try SHA256Digest(validating: hash)
    let decision = try SelectionDecision(
        id: try SelectionDecisionID(validating: uuid(62)), checkInID: checkIn.id, revision: 1,
        rulesVersion: try NonEmptyString(validating: "rules-v1"),
        catalogVersionRequested: try NonEmptyString(validating: "catalog-v1"),
        catalogVersionDelivered: try NonEmptyString(validating: "catalog-v1"),
        outcome: .selected, recommendedLevel: .balanced, requestedOverride: nil,
        overrideDisposition: .none, selectedLevel: .balanced, deliveredLevel: .balanced,
        durationVariant: .standard, secondaryOmissionReason: nil, validationResult: .exact,
        primaryTemplateID: try NonEmptyString(validating: "neck-balanced-standard"),
        primaryTemplateRevision: 1, secondaryModuleID: nil, secondaryModuleRevision: nil,
        compatibilityRuleID: nil, compositionFingerprint: digest, createdAt: time(61),
        areaInputs: [
            try DecisionAreaInput(
                area: .neck, role: .primary, checkInEntryID: entry.id, baseLevel: .balanced,
                activeUnlocked: false, qualifyingCount: 0, latestResponse: nil, included: true
            )
        ],
        reasons: [], notices: []
    )
    try await store.appendDecision(AppendDecisionCommand(decision: decision))
    let session = try RoutineSession(
        id: try RoutineSessionID(validating: uuid(63)), decisionID: decision.id,
        checkInID: checkIn.id, status: .prepared,
        snapshot: OpaqueRoutineSnapshot(bytes: json, checksum: digest, includedAreas: [.neck]),
        currentStepIndex: 0, stepElapsedMilliseconds: 0, startedAt: nil,
        updatedAt: time(62), endedAt: nil, dayContext: day
    )
    try await store.createRoutine(try CreateRoutineCommand(session: session))
    return PreparedGraph(session: session)
}

private func makeProfile() throws -> ProfileState {
    let profile = try UserProfile(
        onboardingCompletedAt: time(2), adultAcknowledged: true,
        safetyBoundaryVersion: NonEmptyString(validating: "safety-v1"),
        safetyAcknowledgedAt: time(2), primaryArea: .neck, secondaryArea: nil,
        routinePreference: nil, weeklyGoalDays: 3, telemetryChoice: .notOffered,
        createdAt: time(1), updatedAt: time(2)
    )
    let reminder = try ReminderSettings(
        enabled: false, window: nil, timeZoneID: nil, updatedAt: time(2)
    )
    return ProfileState(profile: profile, reminderSettings: reminder)
}

private func makeCheckIn(id: Int, entry: CheckInEntry) throws -> CheckIn {
    try CheckIn(
        id: CheckInID(validating: uuid(id)), status: .completed,
        primaryArea: .neck, secondaryArea: nil, startedAt: time(Int64(id)),
        completedAt: time(Int64(id + 1)), dayContext: day, entries: [entry]
    )
}

private func makeDecision(
    id: Int,
    checkIn: CheckIn,
    entries: [CheckInEntry],
    level: RoutineLevel,
    omissionReason: OmissionReason? = nil,
    notices: [DecisionNotice] = []
) throws -> SelectionDecision {
    let inputs = try entries.map { entry in
        try DecisionAreaInput(
            area: entry.area, role: entry.role, checkInEntryID: entry.id,
            baseLevel: level, activeUnlocked: false, qualifyingCount: 0,
            latestResponse: nil, included: true
        )
    }
    return try SelectionDecision(
        id: SelectionDecisionID(validating: uuid(id)), checkInID: checkIn.id, revision: 1,
        rulesVersion: NonEmptyString(validating: "rules-v1"),
        catalogVersionRequested: NonEmptyString(validating: "catalog-v1"),
        catalogVersionDelivered: NonEmptyString(validating: "catalog-v1"),
        outcome: .selected, recommendedLevel: level, requestedOverride: nil,
        overrideDisposition: .none, selectedLevel: level, deliveredLevel: level,
        durationVariant: .standard, secondaryOmissionReason: omissionReason, validationResult: .exact,
        primaryTemplateID: NonEmptyString(validating: "primary"), primaryTemplateRevision: 1,
        secondaryModuleID: entries.count == 2 ? NonEmptyString(validating: "secondary") : nil,
        secondaryModuleRevision: entries.count == 2 ? 1 : nil,
        compatibilityRuleID: entries.count == 2 ? NonEmptyString(validating: "compatible") : nil,
        compositionFingerprint: SHA256Digest(rawValue: String(repeating: "a", count: 64)),
        createdAt: time(200), areaInputs: inputs, reasons: [], notices: notices
    )
}

private func finishRoutine(
    _ session: RoutineSession,
    in store: KineoGRDBStore,
    idBase: Int
) async throws {
    let started = try RoutineEvent(
        id: RoutineEventID(validating: uuid(idBase)), routineSessionID: session.id,
        sequenceNumber: 1, kind: .started, stepID: nil, moduleID: nil,
        alternativeID: nil, localReason: nil, occurredAt: time(Int64(idBase))
    )
    try await store.recordRoutineEvent(
        try RecordRoutineEventCommand(
            event: started,
            checkpoint: RoutineCheckpoint(
                status: .inProgress, currentStepIndex: 0, stepElapsedMilliseconds: 0,
                updatedAt: time(Int64(idBase)), endedAt: nil
            )
        )
    )
    let completed = try RoutineEvent(
        id: RoutineEventID(validating: uuid(idBase + 1)), routineSessionID: session.id,
        sequenceNumber: 2, kind: .completed, stepID: nil, moduleID: nil,
        alternativeID: nil, localReason: nil, occurredAt: time(Int64(idBase + 1))
    )
    try await store.recordRoutineEvent(
        try RecordRoutineEventCommand(
            event: completed,
            checkpoint: RoutineCheckpoint(
                status: .completed, currentStepIndex: 1, stepElapsedMilliseconds: 0,
                updatedAt: time(Int64(idBase + 1)), endedAt: time(Int64(idBase + 1))
            )
        )
    )
}

private let day = LocalDayContext(
    localDay: LocalDay(rawValue: "2026-08-09")!,
    timeZoneID: NonEmptyString(rawValue: "America/Chicago")!,
    calendarID: NonEmptyString(rawValue: "gregorian")!
)

private func time(_ value: Int64) -> TimestampMilliseconds {
    TimestampMilliseconds(rawValue: value)
}

private func uuid(_ value: Int) -> String {
    String(format: "00000000-0000-0000-0000-%012x", value)
}

private final class LifecycleFixture: @unchecked Sendable {
    let location = KineoStoreLocation(
        applicationSupportURL: FileManager.default.temporaryDirectory
            .appending(path: "KineoLifecycleTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    )

    deinit { try? FileManager.default.removeItem(at: location.applicationSupportURL) }

    func open(failure: KineoStoreFailureInjection = .none) async throws -> KineoGRDBStore {
        try await KineoGRDBStore.open(
            location: location,
            storageProtector: NoOpKineoStorageProtector(),
            failure: failure
        )
    }
}

private final class ArmableStorageProtector: @unchecked Sendable, KineoStorageProtecting {
    private let lock = NSLock()
    private var shouldFail = false

    func arm() {
        lock.lock()
        shouldFail = true
        lock.unlock()
    }

    func disarm() {
        lock.lock()
        shouldFail = false
        lock.unlock()
    }

    func preparePrivateDirectory(at url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func protectItem(at url: URL) throws {
        lock.lock()
        let fail = shouldFail
        lock.unlock()
        if fail { throw CocoaError(.fileWriteUnknown) }
    }

    func auditItem(at url: URL) throws -> KineoStorageAuditEntry {
        KineoStorageAuditEntry(
            url: url,
            hasCompleteProtection: true,
            isExcludedFromBackup: true
        )
    }
}

private func assertThrows(
    _ expression: () async throws -> Void,
    verify: (any Error) -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        try await expression()
        XCTFail("Expected an error.", file: file, line: line)
    } catch {
        verify(error)
    }
}
