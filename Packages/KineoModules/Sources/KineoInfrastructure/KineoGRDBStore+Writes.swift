import CryptoKit
import Foundation
import GRDB
import KineoCore

extension KineoGRDBStore: KineoStore {
    public func saveProfile(_ command: SaveProfileCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "saveProfile") { db in
            let profile = command.state.profile
            if let existing = try Row.fetchOne(
                db,
                sql: "SELECT created_at_ms, updated_at_ms FROM user_profile WHERE singleton_id = 1"
            ) {
                let createdAt: Int64 = existing["created_at_ms"]
                let updatedAt: Int64 = existing["updated_at_ms"]
                guard createdAt == profile.createdAt.rawValue,
                      profile.updatedAt.rawValue >= updatedAt else {
                    throw KineoPersistenceFailure.conflict
                }
            }
            try db.execute(
                sql: """
                INSERT INTO user_profile(
                    singleton_id, onboarding_completed_at_ms, adult_acknowledged,
                    safety_boundary_version, safety_acknowledged_at_ms, primary_area,
                    secondary_area, routine_preference, weekly_goal_days, telemetry_choice,
                    created_at_ms, updated_at_ms
                ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(singleton_id) DO UPDATE SET
                    onboarding_completed_at_ms = excluded.onboarding_completed_at_ms,
                    adult_acknowledged = excluded.adult_acknowledged,
                    safety_boundary_version = excluded.safety_boundary_version,
                    safety_acknowledged_at_ms = excluded.safety_acknowledged_at_ms,
                    primary_area = excluded.primary_area,
                    secondary_area = excluded.secondary_area,
                    routine_preference = excluded.routine_preference,
                    weekly_goal_days = excluded.weekly_goal_days,
                    telemetry_choice = excluded.telemetry_choice,
                    updated_at_ms = excluded.updated_at_ms
                """,
                arguments: [
                    profile.onboardingCompletedAt?.rawValue,
                    profile.adultAcknowledged ? 1 : 0,
                    profile.safetyBoundaryVersion?.rawValue,
                    profile.safetyAcknowledgedAt?.rawValue,
                    profile.primaryArea?.rawValue,
                    profile.secondaryArea?.rawValue,
                    profile.routinePreference?.rawValue,
                    profile.weeklyGoalDays,
                    profile.telemetryChoice.rawValue,
                    profile.createdAt.rawValue,
                    profile.updatedAt.rawValue
                ]
            )
            if let reminder = command.state.reminderSettings {
                try db.execute(
                    sql: """
                    INSERT INTO reminder_settings(
                        singleton_id, enabled, window_start_minutes, window_end_minutes,
                        time_zone_id, updated_at_ms
                    ) VALUES (1, ?, ?, ?, ?, ?)
                    ON CONFLICT(singleton_id) DO UPDATE SET
                        enabled = excluded.enabled,
                        window_start_minutes = excluded.window_start_minutes,
                        window_end_minutes = excluded.window_end_minutes,
                        time_zone_id = excluded.time_zone_id,
                        updated_at_ms = excluded.updated_at_ms
                    """,
                    arguments: [
                        reminder.enabled ? 1 : 0,
                        reminder.window?.startMinutes,
                        reminder.window?.endMinutes,
                        reminder.timeZoneID?.rawValue,
                        reminder.updatedAt.rawValue
                    ]
                )
            } else {
                try db.execute(sql: "DELETE FROM reminder_settings WHERE singleton_id = 1")
            }
        }
    }

    public func saveCheckInDraft(_ command: SaveCheckInDraftCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "saveCheckInDraft") { db in
            try Self.replaceMutableCheckIn(command.checkIn, db: db)
        }
    }

    public func completeCheckIn(_ command: CompleteCheckInCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "completeCheckIn") { db in
            try Self.replaceMutableCheckIn(command.checkIn, db: db)
            for mutation in command.safetyMutations {
                try Self.apply(mutation, db: db)
            }
        }
    }

    public func applySafetyMutation(_ command: ApplySafetyMutationCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "applySafetyMutation") { db in
            try Self.apply(command.mutation, db: db)
        }
    }

    public func appendDecision(_ command: AppendDecisionCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "appendDecision") { db in
            let decision = command.decision
            let attentionCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM attention_states") ?? 0
            guard attentionCount == 0 else { throw KineoPersistenceFailure.conflict }
            guard let checkIn = try Row.fetchOne(
                db,
                sql: "SELECT status, primary_area, secondary_area FROM check_ins WHERE id = ?",
                arguments: [decision.checkInID.rawValue]
            ), checkIn["status"] == CheckInStatus.completed.rawValue,
               let profile = try Row.fetchOne(
                   db,
                   sql: "SELECT primary_area, secondary_area FROM user_profile WHERE singleton_id = 1"
               ) else {
                throw KineoPersistenceFailure.notFound
            }
            let checkInSecondary: String? = checkIn["secondary_area"]
            let profileSecondary: String? = profile["secondary_area"]
            let checkInPrimary: String = checkIn["primary_area"]
            let profilePrimary: String? = profile["primary_area"]
            guard checkInPrimary == profilePrimary,
                  checkInSecondary == nil || checkInSecondary == profileSecondary else {
                throw KineoPersistenceFailure.conflict
            }
            if profileSecondary != nil, checkInSecondary == nil {
                guard decision.secondaryOmissionReason == .secondaryUnanswered,
                      decision.notices.contains(where: { $0.code.rawValue == "notice.secondary_skipped" }) else {
                    throw KineoPersistenceFailure.constraint
                }
            }
            let unsafeEntryCount = try Int.fetchOne(
                db,
                sql: """
                SELECT COUNT(*) FROM check_in_entries
                WHERE check_in_id = ? AND conditional_safety_answer IN ('yes', 'notSure')
                """,
                arguments: [decision.checkInID.rawValue]
            ) ?? 0
            let pauseCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM pause_today_events WHERE check_in_id = ?",
                arguments: [decision.checkInID.rawValue]
            ) ?? 0
            let routineCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM routine_sessions WHERE check_in_id = ?",
                arguments: [decision.checkInID.rawValue]
            ) ?? 0
            guard unsafeEntryCount == 0, pauseCount == 0, routineCount == 0 else {
                throw KineoPersistenceFailure.conflict
            }
            let lastRevision = try Int.fetchOne(
                db,
                sql: "SELECT MAX(revision) FROM selection_decisions WHERE check_in_id = ?",
                arguments: [decision.checkInID.rawValue]
            ) ?? 0
            guard decision.revision == lastRevision + 1 else {
                throw KineoPersistenceFailure.conflict
            }
            guard decision.areaInputs.contains(where: { $0.role == .primary && $0.included }) else {
                throw KineoPersistenceFailure.constraint
            }
            let persistedEntryIDs = Set(try String.fetchAll(
                db,
                sql: "SELECT id FROM check_in_entries WHERE check_in_id = ?",
                arguments: [decision.checkInID.rawValue]
            ))
            guard Set(decision.areaInputs.map(\.checkInEntryID.rawValue)) == persistedEntryIDs else {
                throw KineoPersistenceFailure.constraint
            }
            for input in decision.areaInputs {
                let entry = try Row.fetchOne(
                    db,
                    sql: "SELECT check_in_id, area, role FROM check_in_entries WHERE id = ?",
                    arguments: [input.checkInEntryID.rawValue]
                )
                guard entry?["check_in_id"] == decision.checkInID.rawValue,
                      entry?["area"] == input.area.rawValue,
                      entry?["role"] == input.role.rawValue else {
                    throw KineoPersistenceFailure.constraint
                }
            }
            try Self.insert(decision, db: db)
        }
    }

    public func recordPauseToday(_ command: RecordPauseTodayCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "recordPauseToday") { db in
            let event = command.event
            if let existing = try Row.fetchOne(
                db,
                sql: "SELECT * FROM pause_today_events WHERE id = ?",
                arguments: [event.id.rawValue]
            ) {
                guard existing["check_in_id"] == event.checkInID.rawValue,
                      existing["chosen_at_ms"] == event.chosenAt.rawValue,
                      existing["local_day"] == event.dayContext.localDay.rawValue,
                      existing["time_zone_id"] == event.dayContext.timeZoneID.rawValue,
                      existing["calendar_id"] == event.dayContext.calendarID.rawValue else {
                    throw KineoPersistenceFailure.conflict
                }
                return
            }
            let status = try String.fetchOne(
                db,
                sql: "SELECT status FROM check_ins WHERE id = ?",
                arguments: [event.checkInID.rawValue]
            )
            guard status == CheckInStatus.completed.rawValue else { throw KineoPersistenceFailure.notFound }
            let attentionCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM attention_states") ?? 0
            let eligibleEntryCount = try Int.fetchOne(
                db,
                sql: """
                SELECT COUNT(*) FROM check_in_entries
                WHERE check_in_id = ?
                  AND (change_report = 'worse' OR movement_comfort = 'limited')
                  AND conditional_safety_answer = 'no'
                """,
                arguments: [event.checkInID.rawValue]
            ) ?? 0
            let unsafeEntryCount = try Int.fetchOne(
                db,
                sql: """
                SELECT COUNT(*) FROM check_in_entries
                WHERE check_in_id = ? AND conditional_safety_answer IN ('yes', 'notSure')
                """,
                arguments: [event.checkInID.rawValue]
            ) ?? 0
            let latestDecision = try Row.fetchOne(
                db,
                sql: """
                SELECT outcome, recommended_level FROM selection_decisions
                WHERE check_in_id = ? ORDER BY revision DESC LIMIT 1
                """,
                arguments: [event.checkInID.rawValue]
            )
            let routineCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM routine_sessions WHERE check_in_id = ?",
                arguments: [event.checkInID.rawValue]
            ) ?? 0
            guard attentionCount == 0,
                  eligibleEntryCount > 0,
                  unsafeEntryCount == 0,
                  latestDecision?["outcome"] == SelectionOutcome.selected.rawValue,
                  latestDecision?["recommended_level"] == RoutineLevel.gentle.rawValue,
                  routineCount == 0 else {
                throw KineoPersistenceFailure.conflict
            }
            try db.execute(
                sql: """
                INSERT INTO pause_today_events(
                    id, check_in_id, chosen_at_ms, local_day, time_zone_id, calendar_id
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                arguments: [
                    event.id.rawValue, event.checkInID.rawValue, event.chosenAt.rawValue,
                    event.dayContext.localDay.rawValue, event.dayContext.timeZoneID.rawValue,
                    event.dayContext.calendarID.rawValue
                ]
            )
        }
    }

    public func createRoutine(_ command: CreateRoutineCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "createRoutine") { db in
            let session = command.session
            try Self.validateSnapshot(session.snapshot)
            let decision = try Row.fetchOne(
                db,
                sql: "SELECT check_in_id, outcome, revision FROM selection_decisions WHERE id = ?",
                arguments: [session.decisionID.rawValue]
            )
            guard decision?["check_in_id"] == session.checkInID.rawValue,
                  decision?["outcome"] == SelectionOutcome.selected.rawValue else {
                throw KineoPersistenceFailure.constraint
            }
            let latestRevision = try Int.fetchOne(
                db,
                sql: "SELECT MAX(revision) FROM selection_decisions WHERE check_in_id = ?",
                arguments: [session.checkInID.rawValue]
            )
            guard decision?["revision"] == latestRevision else { throw KineoPersistenceFailure.conflict }
            let includedDecisionAreas = Set(try String.fetchAll(
                db,
                sql: "SELECT area FROM decision_area_inputs WHERE decision_id = ? AND included = 1",
                arguments: [session.decisionID.rawValue]
            ))
            guard includedDecisionAreas == Set(session.snapshot.includedAreas.map(\.rawValue)) else {
                throw KineoPersistenceFailure.constraint
            }
            let attentionCount = try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM attention_states") ?? 0
            guard attentionCount == 0 else { throw KineoPersistenceFailure.conflict }
            let pauseCount = try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM pause_today_events WHERE check_in_id = ?",
                arguments: [session.checkInID.rawValue]
            ) ?? 0
            guard pauseCount == 0 else { throw KineoPersistenceFailure.conflict }
            try Self.insert(session, db: db)
        }
    }

    public func recordRoutineEvent(_ command: RecordRoutineEventCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "recordRoutineEvent") { db in
            let event = command.event
            if let existing = try Row.fetchOne(
                db,
                sql: "SELECT * FROM routine_events WHERE id = ?",
                arguments: [event.id.rawValue]
            ) {
                let stepID: String? = existing["step_id"]
                let moduleID: String? = existing["module_id"]
                let alternativeID: String? = existing["alternative_id"]
                let reason: String? = existing["local_reason_code"]
                let endedAt: Int64? = existing["resulting_ended_at_ms"]
                guard existing["routine_session_id"] == event.routineSessionID.rawValue,
                      existing["sequence_number"] == event.sequenceNumber,
                      existing["kind"] == event.kind.rawValue,
                      stepID == event.stepID?.rawValue,
                      moduleID == event.moduleID?.rawValue,
                      alternativeID == event.alternativeID?.rawValue,
                      reason == event.localReason?.rawValue,
                      existing["occurred_at_ms"] == event.occurredAt.rawValue,
                      existing["resulting_status"] == command.checkpoint.status.rawValue,
                      existing["resulting_step_index"] == command.checkpoint.currentStepIndex,
                      existing["resulting_step_elapsed_ms"] == command.checkpoint.stepElapsedMilliseconds,
                      existing["resulting_updated_at_ms"] == command.checkpoint.updatedAt.rawValue,
                      endedAt == command.checkpoint.endedAt?.rawValue else {
                    throw KineoPersistenceFailure.conflict
                }
                return
            }
            guard let currentRow = try Row.fetchOne(
                db,
                sql: "SELECT status, started_at_ms, updated_at_ms FROM routine_sessions WHERE id = ?",
                arguments: [event.routineSessionID.rawValue]
            ), let current = RoutineStatus(rawValue: currentRow["status"]) else {
                throw KineoPersistenceFailure.notFound
            }
            let currentUpdatedAt: Int64 = currentRow["updated_at_ms"]
            let currentStartedAt: Int64? = currentRow["started_at_ms"]
            guard event.occurredAt.rawValue >= currentUpdatedAt,
                  command.checkpoint.updatedAt.rawValue >= event.occurredAt.rawValue,
                  command.checkpoint.endedAt.map({ $0.rawValue >= event.occurredAt.rawValue }) ?? true,
                  command.checkpoint.endedAt.map({ endedAt in
                      currentStartedAt.map { endedAt.rawValue >= $0 } ?? true
                  }) ?? true else {
                throw KineoPersistenceFailure.invalidTransition
            }
            guard Self.isValidTransition(from: current, event: event.kind, to: command.checkpoint.status) else {
                throw KineoPersistenceFailure.invalidTransition
            }
            let expectedSequence = (try Int.fetchOne(
                db,
                sql: "SELECT MAX(sequence_number) FROM routine_events WHERE routine_session_id = ?",
                arguments: [event.routineSessionID.rawValue]
            ) ?? 0) + 1
            guard event.sequenceNumber == expectedSequence else { throw KineoPersistenceFailure.conflict }
            try db.execute(
                sql: """
                INSERT INTO routine_events(
                    id, routine_session_id, sequence_number, kind, step_id, module_id,
                    alternative_id, local_reason_code, occurred_at_ms, resulting_status,
                    resulting_step_index, resulting_step_elapsed_ms, resulting_updated_at_ms,
                    resulting_ended_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                arguments: [
                    event.id.rawValue, event.routineSessionID.rawValue, event.sequenceNumber,
                    event.kind.rawValue, event.stepID?.rawValue, event.moduleID?.rawValue,
                    event.alternativeID?.rawValue, event.localReason?.rawValue, event.occurredAt.rawValue,
                    command.checkpoint.status.rawValue, command.checkpoint.currentStepIndex,
                    command.checkpoint.stepElapsedMilliseconds, command.checkpoint.updatedAt.rawValue,
                    command.checkpoint.endedAt?.rawValue
                ]
            )
            try db.execute(
                sql: """
                UPDATE routine_sessions SET status = ?, current_step_index = ?, step_elapsed_ms = ?,
                    started_at_ms = CASE WHEN ? = 'started' THEN ? ELSE started_at_ms END,
                    updated_at_ms = ?, ended_at_ms = ?
                WHERE id = ?
                """,
                arguments: [
                    command.checkpoint.status.rawValue, command.checkpoint.currentStepIndex,
                    command.checkpoint.stepElapsedMilliseconds, event.kind.rawValue,
                    event.occurredAt.rawValue, command.checkpoint.updatedAt.rawValue,
                    command.checkpoint.endedAt?.rawValue, event.routineSessionID.rawValue
                ]
            )
        }
    }

    public func submitFeedback(_ command: SubmitFeedbackCommand) async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "submitFeedback") { db in
            let submission = command.submission
            if let existing = try Row.fetchOne(
                db,
                sql: "SELECT * FROM feedback_submissions WHERE id = ?",
                arguments: [submission.id.rawValue]
            ) {
                let existingResponses = try Row.fetchAll(
                    db,
                    sql: "SELECT id, area, response FROM area_feedback WHERE feedback_submission_id = ? ORDER BY area, id",
                    arguments: [submission.id.rawValue]
                ).map { row -> String in
                    "\(row["id"] as String)|\(row["area"] as String)|\(row["response"] as String)"
                }
                let requestedResponses = submission.responses
                    .map { "\($0.id.rawValue)|\($0.area.rawValue)|\($0.response.rawValue)" }
                    .sorted()
                guard existing["routine_session_id"] == submission.routineSessionID.rawValue,
                      existing["submitted_at_ms"] == submission.submittedAt.rawValue,
                      existing["local_day"] == submission.dayContext.localDay.rawValue,
                      existing["time_zone_id"] == submission.dayContext.timeZoneID.rawValue,
                      existing["calendar_id"] == submission.dayContext.calendarID.rawValue,
                      existingResponses.sorted() == requestedResponses else {
                    throw KineoPersistenceFailure.conflict
                }
                return
            }
            guard let session = try Row.fetchOne(
                db,
                sql: "SELECT status, ended_at_ms, routine_snapshot_json, snapshot_checksum FROM routine_sessions WHERE id = ?",
                arguments: [submission.routineSessionID.rawValue]
            ), let status = RoutineStatus(rawValue: session["status"]) else {
                throw KineoPersistenceFailure.notFound
            }
            guard status.acceptsFeedback else { throw KineoPersistenceFailure.conflict }
            let endedAt: Int64? = session["ended_at_ms"]
            guard let endedAt, submission.submittedAt.rawValue >= endedAt else {
                throw KineoPersistenceFailure.constraint
            }
            let bytes = Data((session["routine_snapshot_json"] as String).utf8)
            let includedAreas = try Self.includedAreas(in: bytes)
            guard submission.responses.allSatisfy({ includedAreas.contains($0.area) }) else {
                throw KineoPersistenceFailure.constraint
            }
            try db.execute(
                sql: """
                INSERT INTO feedback_submissions(
                    id, routine_session_id, submitted_at_ms, local_day, time_zone_id, calendar_id
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                arguments: [
                    submission.id.rawValue, submission.routineSessionID.rawValue,
                    submission.submittedAt.rawValue, submission.dayContext.localDay.rawValue,
                    submission.dayContext.timeZoneID.rawValue, submission.dayContext.calendarID.rawValue
                ]
            )
            for response in submission.responses {
                try db.execute(
                    sql: """
                    INSERT INTO area_feedback(
                        id, feedback_submission_id, area, response, submitted_at_ms,
                        local_day, time_zone_id, calendar_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    arguments: [
                        response.id.rawValue, submission.id.rawValue, response.area.rawValue,
                        response.response.rawValue, submission.submittedAt.rawValue,
                        submission.dayContext.localDay.rawValue, submission.dayContext.timeZoneID.rawValue,
                        submission.dayContext.calendarID.rawValue
                    ]
                )
            }
        }
    }

    public func resetHistory() async throws(KineoCore.PersistenceError) {
        try await performWrite(name: "resetHistory") { db in
            try db.execute(sql: "DELETE FROM feedback_submissions")
            try db.execute(sql: "DELETE FROM routine_events")
            try db.execute(sql: "DELETE FROM routine_sessions")
            try db.execute(sql: "DELETE FROM decision_notices")
            try db.execute(sql: "DELETE FROM decision_reasons")
            try db.execute(sql: "DELETE FROM decision_area_inputs")
            try db.execute(sql: "DELETE FROM selection_decisions")
            try db.execute(sql: "DELETE FROM pause_today_events")
            try db.execute(sql: "DELETE FROM safety_events")
            try db.execute(sql: "DELETE FROM check_in_entries")
            try db.execute(sql: "DELETE FROM check_ins")
        }
    }

    public func deleteAllData() async throws(KineoCore.PersistenceError) {
        do {
            try await requireProtectedData()
            try performVerifiedDeletion()
        } catch {
            throw await mapOperationError(error)
        }
    }

    private func performWrite(
        name: String,
        operation: @Sendable (Database) throws -> Void
    ) async throws(KineoCore.PersistenceError) {
        do {
            try await requireProtectedData()
            _ = try transaction(name: name) { db in
                try operation(db)
                return true
            }
        } catch {
            throw await mapOperationError(error)
        }
    }

    private static func replaceMutableCheckIn(_ checkIn: CheckIn, db: Database) throws {
        if let existingStatus = try String.fetchOne(
            db,
            sql: "SELECT status FROM check_ins WHERE id = ?",
            arguments: [checkIn.id.rawValue]
        ) {
            guard existingStatus == CheckInStatus.draft.rawValue else {
                throw KineoPersistenceFailure.conflict
            }
            try db.execute(sql: "DELETE FROM check_ins WHERE id = ?", arguments: [checkIn.id.rawValue])
        }
        if let correction = checkIn.correctionSource {
            let attentionExists = (try Int.fetchOne(
                db,
                sql: "SELECT COUNT(*) FROM attention_states WHERE area = ?",
                arguments: [correction.area.rawValue]
            ) ?? 0) == 1
            guard attentionExists else { throw KineoPersistenceFailure.constraint }
            if let triggeringEntryID = correction.triggeringEntryID {
                let source = try Row.fetchOne(
                    db,
                    sql: """
                    SELECT e.area, e.conditional_safety_answer,
                           c.status AS check_in_status
                    FROM check_in_entries e
                    JOIN check_ins c ON c.id = e.check_in_id
                    WHERE e.id = ?
                    """,
                    arguments: [triggeringEntryID.rawValue]
                )
                let answer: String? = source?["conditional_safety_answer"]
                guard source?["area"] == correction.area.rawValue,
                      source?["check_in_status"] == CheckInStatus.completed.rawValue,
                      answer == ConditionalSafetyAnswer.yes.rawValue ||
                        answer == ConditionalSafetyAnswer.notSure.rawValue else {
                    throw KineoPersistenceFailure.constraint
                }
            } else {
                let retainedTriggerCount = try Int.fetchOne(
                    db,
                    sql: """
                    SELECT COUNT(*) FROM check_in_entries
                    WHERE area = ? AND conditional_safety_answer IN ('yes', 'notSure')
                    """,
                    arguments: [correction.area.rawValue]
                ) ?? 0
                guard retainedTriggerCount == 0 else { throw KineoPersistenceFailure.constraint }
            }
        }
        try db.execute(
            sql: """
            INSERT INTO check_ins(
                id, status, purpose, primary_area, secondary_area, correction_area,
                source_triggering_entry_id, started_at_ms, completed_at_ms,
                local_day, time_zone_id, calendar_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            arguments: [
                checkIn.id.rawValue, checkIn.status.rawValue, checkIn.kind.rawValue,
                checkIn.primaryArea.rawValue, checkIn.secondaryArea?.rawValue,
                checkIn.correctionSource?.area.rawValue,
                checkIn.correctionSource?.triggeringEntryID?.rawValue,
                checkIn.startedAt.rawValue, checkIn.completedAt?.rawValue,
                checkIn.dayContext.localDay.rawValue, checkIn.dayContext.timeZoneID.rawValue,
                checkIn.dayContext.calendarID.rawValue
            ]
        )
        for entry in checkIn.entries {
            try db.execute(
                sql: """
                INSERT INTO check_in_entries(
                    id, check_in_id, area, role, change_report, movement_comfort,
                    conditional_safety_answer, submitted_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                arguments: [
                    entry.id.rawValue, checkIn.id.rawValue, entry.area.rawValue, entry.role.rawValue,
                    entry.changeReport.rawValue, entry.movementComfort.rawValue,
                    entry.conditionalSafetyAnswer?.rawValue, entry.submittedAt.rawValue
                ]
            )
        }
    }

    private static func apply(_ mutation: SafetyMutation, db: Database) throws {
        let event = mutation.event
        let currentUpdatedAt = try Int64.fetchOne(
            db,
            sql: "SELECT updated_at_ms FROM attention_states WHERE area = ?",
            arguments: [event.area.rawValue]
        )
        switch event.kind {
        case .attentionEntered:
            guard currentUpdatedAt == nil,
                  mutation.expectedAttentionUpdatedAt == nil else {
                throw KineoPersistenceFailure.invalidTransition
            }
        case .attentionClearedReturnedToUsual, .attentionClearedCorrection,
             .attentionReaffirmed, .attentionReaffirmedCorrection:
            guard currentUpdatedAt == mutation.expectedAttentionUpdatedAt?.rawValue else {
                throw KineoPersistenceFailure.conflict
            }
        }
        try db.execute(
            sql: """
            INSERT INTO safety_events(
                id, area, kind, source_check_in_entry_id, return_answer,
                occurred_at_ms, local_day, time_zone_id, calendar_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            arguments: [
                event.id.rawValue, event.area.rawValue, event.kind.rawValue,
                event.sourceCheckInEntryID?.rawValue, event.returnAnswer?.rawValue,
                event.occurredAt.rawValue, event.dayContext.localDay.rawValue,
                event.dayContext.timeZoneID.rawValue, event.dayContext.calendarID.rawValue
            ]
        )
        if mutation.statusAfter == .attentionRequired {
            try db.execute(
                sql: """
                INSERT INTO attention_states(area, updated_at_ms) VALUES (?, ?)
                ON CONFLICT(area) DO UPDATE SET updated_at_ms = excluded.updated_at_ms
                """,
                arguments: [event.area.rawValue, event.occurredAt.rawValue]
            )
        } else {
            try db.execute(sql: "DELETE FROM attention_states WHERE area = ?", arguments: [event.area.rawValue])
        }
    }

    private static func insert(_ decision: SelectionDecision, db: Database) throws {
        try db.execute(
            sql: """
            INSERT INTO selection_decisions(
                id, check_in_id, revision, rules_version, catalog_version_requested,
                catalog_version_delivered, outcome, recommended_level, requested_override,
                override_disposition, selected_level, delivered_level, duration_variant,
                secondary_omission_reason, validation_result, primary_template_id,
                primary_template_revision, secondary_module_id, secondary_module_revision,
                compatibility_rule_id, composition_fingerprint, created_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            arguments: [
                decision.id.rawValue, decision.checkInID.rawValue, decision.revision,
                decision.rulesVersion.rawValue, decision.catalogVersionRequested.rawValue,
                decision.catalogVersionDelivered?.rawValue, decision.outcome.rawValue,
                decision.recommendedLevel.rawValue, decision.requestedOverride?.rawValue,
                decision.overrideDisposition.rawValue, decision.selectedLevel.rawValue,
                decision.deliveredLevel?.rawValue, decision.durationVariant.rawValue,
                decision.secondaryOmissionReason?.rawValue, decision.validationResult.rawValue,
                decision.primaryTemplateID?.rawValue, decision.primaryTemplateRevision,
                decision.secondaryModuleID?.rawValue, decision.secondaryModuleRevision,
                decision.compatibilityRuleID?.rawValue, decision.compositionFingerprint?.rawValue,
                decision.createdAt.rawValue
            ]
        )
        for input in decision.areaInputs {
            try db.execute(
                sql: """
                INSERT INTO decision_area_inputs(
                    decision_id, area, role, check_in_entry_id, base_level,
                    active_unlocked, qualifying_count, latest_response, included
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                arguments: [
                    decision.id.rawValue, input.area.rawValue, input.role.rawValue,
                    input.checkInEntryID.rawValue, input.baseLevel.rawValue,
                    input.activeUnlocked ? 1 : 0, input.qualifyingCount,
                    input.latestResponse?.rawValue, input.included ? 1 : 0
                ]
            )
        }
        for reason in decision.reasons {
            guard let parameters = String(data: reason.parameters.bytes, encoding: .utf8) else {
                throw KineoPersistenceFailure.constraint
            }
            try db.execute(
                sql: "INSERT INTO decision_reasons(decision_id, kind, position, reason_code, parameters_json) VALUES (?, ?, ?, ?, ?)",
                arguments: [decision.id.rawValue, reason.kind.rawValue, reason.position, reason.code.rawValue, parameters]
            )
        }
        for notice in decision.notices {
            guard let parameters = String(data: notice.parameters.bytes, encoding: .utf8) else {
                throw KineoPersistenceFailure.constraint
            }
            try db.execute(
                sql: "INSERT INTO decision_notices(decision_id, position, notice_code, area, parameters_json) VALUES (?, ?, ?, ?, ?)",
                arguments: [decision.id.rawValue, notice.position, notice.code.rawValue, notice.area?.rawValue, parameters]
            )
        }
    }

    private static func insert(_ session: RoutineSession, db: Database) throws {
        guard let snapshotJSON = String(data: session.snapshot.bytes, encoding: .utf8) else {
            throw KineoPersistenceFailure.constraint
        }
        try db.execute(
            sql: """
            INSERT INTO routine_sessions(
                id, decision_id, check_in_id, status, routine_snapshot_json, snapshot_checksum,
                current_step_index, step_elapsed_ms, started_at_ms, updated_at_ms, ended_at_ms,
                local_day, time_zone_id, calendar_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            arguments: [
                session.id.rawValue, session.decisionID.rawValue, session.checkInID.rawValue,
                session.status.rawValue, snapshotJSON, session.snapshot.checksum.rawValue,
                session.currentStepIndex, session.stepElapsedMilliseconds, session.startedAt?.rawValue,
                session.updatedAt.rawValue, session.endedAt?.rawValue,
                session.dayContext.localDay.rawValue, session.dayContext.timeZoneID.rawValue,
                session.dayContext.calendarID.rawValue
            ]
        )
    }

    private static func validateSnapshot(_ snapshot: OpaqueRoutineSnapshot) throws {
        let actual = SHA256.hash(data: snapshot.bytes).map { String(format: "%02x", $0) }.joined()
        guard actual == snapshot.checksum.rawValue,
              try includedAreas(in: snapshot.bytes) == snapshot.includedAreas else {
            throw KineoPersistenceFailure.constraint
        }
    }

    static func includedAreas(in bytes: Data) throws -> [BodyArea] {
        guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let rawAreas = object["includedAreas"] as? [String] else {
            throw KineoPersistenceFailure.constraint
        }
        let areas = rawAreas.compactMap(BodyArea.init(rawValue:))
        guard areas.count == rawAreas.count,
              (BodyAreaSelectionLimits.minimumCount...BodyAreaSelectionLimits.maximumCount)
                .contains(areas.count),
              Set(areas).count == areas.count else {
            throw KineoPersistenceFailure.constraint
        }
        return areas
    }

    private static func isValidTransition(
        from current: RoutineStatus,
        event: RoutineEventKind,
        to next: RoutineStatus
    ) -> Bool {
        switch event {
        case .started: current == .prepared && next == .inProgress
        case .paused: current == .inProgress && next == .paused
        case .resumed: current == .paused && next == .inProgress
        case .stepCompleted, .skipped, .alternativeSelected:
            current == .inProgress && next == .inProgress
        case .completed: (current == .inProgress || current == .paused) && next == .completed
        case .stopped: (current == .inProgress || current == .paused) && next == .stopped
        case .safetyStopped: (current == .inProgress || current == .paused) && next == .safetyStopped
        case .abandoned: !current.isTerminal && next == .abandoned
        }
    }
}
