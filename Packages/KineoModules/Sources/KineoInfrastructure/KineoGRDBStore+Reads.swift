import CryptoKit
import Foundation
import GRDB
import KineoCore

extension KineoGRDBStore {
    public func loadSnapshot() async throws(KineoCore.PersistenceError) -> KineoDataSnapshot {
        do {
            try await requireProtectedData()
            return try read { db in
                do {
                    return try Self.decodeSnapshot(db)
                } catch let error as KineoPersistenceFailure {
                    throw error
                } catch {
                    throw KineoPersistenceFailure.corruptStore
                }
            }
        } catch {
            throw await mapOperationError(error)
        }
    }

    private static func decodeSnapshot(_ db: Database) throws -> KineoDataSnapshot {
        let checkIns = try Row.fetchAll(db, sql: "SELECT * FROM check_ins ORDER BY started_at_ms, id").map { row in
            let id = try CheckInID(validating: row["id"])
            let entryRows = try Row.fetchAll(
                db,
                sql: "SELECT * FROM check_in_entries WHERE check_in_id = ? ORDER BY role, id",
                arguments: [id.rawValue]
            )
            let entries = try entryRows.map(decodeCheckInEntry)
            let kind = try requiredEnum(CheckInKind.self, row["purpose"])
            let correction: CorrectionSource?
            if kind == .attentionCorrection {
                guard let areaRaw: String = row["correction_area"] else {
                    throw KineoPersistenceFailure.corruptStore
                }
                let sourceRaw: String? = row["source_triggering_entry_id"]
                correction = CorrectionSource(
                    area: try requiredEnum(BodyArea.self, areaRaw),
                    triggeringEntryID: try sourceRaw.map(CheckInEntryID.init(validating:))
                )
            } else {
                correction = nil
            }
            return try CheckIn(
                id: id,
                status: try requiredEnum(CheckInStatus.self, row["status"]),
                kind: kind,
                correctionSource: correction,
                primaryArea: try requiredEnum(BodyArea.self, row["primary_area"]),
                secondaryArea: try optionalEnum(BodyArea.self, row["secondary_area"]),
                startedAt: TimestampMilliseconds(rawValue: row["started_at_ms"]),
                completedAt: optionalTimestamp(row["completed_at_ms"]),
                dayContext: try dayContext(row),
                entries: entries
            )
        }

        let profileState: ProfileState?
        if let row = try Row.fetchOne(db, sql: "SELECT * FROM user_profile WHERE singleton_id = 1") {
            let profile = try UserProfile(
                onboardingCompletedAt: optionalTimestamp(row["onboarding_completed_at_ms"]),
                adultAcknowledged: (row["adult_acknowledged"] as Int) == 1,
                safetyBoundaryVersion: try optionalNonEmpty(row["safety_boundary_version"]),
                safetyAcknowledgedAt: optionalTimestamp(row["safety_acknowledged_at_ms"]),
                primaryArea: try optionalEnum(BodyArea.self, row["primary_area"]),
                secondaryArea: try optionalEnum(BodyArea.self, row["secondary_area"]),
                routinePreference: try optionalNonEmpty(row["routine_preference"]),
                weeklyGoalDays: row["weekly_goal_days"],
                telemetryChoice: try requiredEnum(TelemetryChoice.self, row["telemetry_choice"]),
                createdAt: TimestampMilliseconds(rawValue: row["created_at_ms"]),
                updatedAt: TimestampMilliseconds(rawValue: row["updated_at_ms"])
            )
            let reminder: ReminderSettings?
            if let reminderRow = try Row.fetchOne(db, sql: "SELECT * FROM reminder_settings WHERE singleton_id = 1") {
                let start: Int? = reminderRow["window_start_minutes"]
                let end: Int? = reminderRow["window_end_minutes"]
                let window: ReminderWindow?
                if let start, let end {
                    window = try ReminderWindow(startMinutes: start, endMinutes: end)
                } else {
                    window = nil
                }
                reminder = try ReminderSettings(
                    enabled: (reminderRow["enabled"] as Int) == 1,
                    window: window,
                    timeZoneID: try optionalNonEmpty(reminderRow["time_zone_id"]),
                    updatedAt: TimestampMilliseconds(rawValue: reminderRow["updated_at_ms"])
                )
            } else {
                reminder = nil
            }
            profileState = ProfileState(profile: profile, reminderSettings: reminder)
        } else {
            profileState = nil
        }

        let attentionStates = try Row.fetchAll(
            db,
            sql: "SELECT * FROM attention_states ORDER BY area"
        ).map { row in
            AttentionState(
                area: try requiredEnum(BodyArea.self, row["area"]),
                updatedAt: TimestampMilliseconds(rawValue: row["updated_at_ms"])
            )
        }

        let safetyEvents = try Row.fetchAll(
            db,
            sql: "SELECT * FROM safety_events ORDER BY occurred_at_ms, id"
        ).map { row in
            let sourceRaw: String? = row["source_check_in_entry_id"]
            return try SafetyEvent(
                id: try SafetyEventID(validating: row["id"]),
                area: try requiredEnum(BodyArea.self, row["area"]),
                kind: try requiredEnum(SafetyEventKind.self, row["kind"]),
                sourceCheckInEntryID: try sourceRaw.map(CheckInEntryID.init(validating:)),
                returnAnswer: try optionalEnum(ConditionalSafetyAnswer.self, row["return_answer"]),
                occurredAt: TimestampMilliseconds(rawValue: row["occurred_at_ms"]),
                dayContext: try dayContext(row)
            )
        }

        let pauseEvents = try Row.fetchAll(
            db,
            sql: "SELECT * FROM pause_today_events ORDER BY chosen_at_ms, id"
        ).map { row in
            PauseTodayEvent(
                id: try PauseTodayEventID(validating: row["id"]),
                checkInID: try CheckInID(validating: row["check_in_id"]),
                chosenAt: TimestampMilliseconds(rawValue: row["chosen_at_ms"]),
                dayContext: try dayContext(row)
            )
        }

        let decisions = try Row.fetchAll(
            db,
            sql: "SELECT * FROM selection_decisions ORDER BY created_at_ms, check_in_id, revision"
        ).map { row in
            let id = try SelectionDecisionID(validating: row["id"])
            let inputRows = try Row.fetchAll(
                db,
                sql: "SELECT * FROM decision_area_inputs WHERE decision_id = ? ORDER BY role, area",
                arguments: [id.rawValue]
            )
            let inputs = try inputRows.map { input in
                try DecisionAreaInput(
                    area: requiredEnum(BodyArea.self, input["area"]),
                    role: requiredEnum(AreaRole.self, input["role"]),
                    checkInEntryID: CheckInEntryID(validating: input["check_in_entry_id"]),
                    baseLevel: requiredEnum(RoutineLevel.self, input["base_level"]),
                    activeUnlocked: (input["active_unlocked"] as Int) == 1,
                    qualifyingCount: input["qualifying_count"],
                    latestResponse: optionalEnum(AreaResponse.self, input["latest_response"]),
                    included: (input["included"] as Int) == 1
                )
            }
            let reasons = try Row.fetchAll(
                db,
                sql: "SELECT * FROM decision_reasons WHERE decision_id = ? ORDER BY kind, position",
                arguments: [id.rawValue]
            ).map { reason in
                try DecisionReason(
                    kind: requiredEnum(DecisionReasonKind.self, reason["kind"]),
                    position: reason["position"],
                    code: NonEmptyString(validating: reason["reason_code"]),
                    parameters: CanonicalJSON(bytes: Data((reason["parameters_json"] as String).utf8))
                )
            }
            let notices = try Row.fetchAll(
                db,
                sql: "SELECT * FROM decision_notices WHERE decision_id = ? ORDER BY position",
                arguments: [id.rawValue]
            ).map { notice in
                try DecisionNotice(
                    position: notice["position"],
                    code: NonEmptyString(validating: notice["notice_code"]),
                    area: optionalEnum(BodyArea.self, notice["area"]),
                    parameters: CanonicalJSON(bytes: Data((notice["parameters_json"] as String).utf8))
                )
            }
            let fingerprintRaw: String? = row["composition_fingerprint"]
            return try SelectionDecision(
                id: id,
                checkInID: CheckInID(validating: row["check_in_id"]),
                revision: row["revision"],
                rulesVersion: NonEmptyString(validating: row["rules_version"]),
                catalogVersionRequested: NonEmptyString(validating: row["catalog_version_requested"]),
                catalogVersionDelivered: try optionalNonEmpty(row["catalog_version_delivered"]),
                outcome: requiredEnum(SelectionOutcome.self, row["outcome"]),
                recommendedLevel: requiredEnum(RoutineLevel.self, row["recommended_level"]),
                requestedOverride: optionalEnum(RoutineLevel.self, row["requested_override"]),
                overrideDisposition: requiredEnum(OverrideDisposition.self, row["override_disposition"]),
                selectedLevel: requiredEnum(RoutineLevel.self, row["selected_level"]),
                deliveredLevel: optionalEnum(RoutineLevel.self, row["delivered_level"]),
                durationVariant: requiredEnum(DurationVariant.self, row["duration_variant"]),
                secondaryOmissionReason: optionalEnum(OmissionReason.self, row["secondary_omission_reason"]),
                validationResult: requiredEnum(ValidationResult.self, row["validation_result"]),
                primaryTemplateID: try optionalNonEmpty(row["primary_template_id"]),
                primaryTemplateRevision: row["primary_template_revision"],
                secondaryModuleID: try optionalNonEmpty(row["secondary_module_id"]),
                secondaryModuleRevision: row["secondary_module_revision"],
                compatibilityRuleID: try optionalNonEmpty(row["compatibility_rule_id"]),
                compositionFingerprint: try fingerprintRaw.map(SHA256Digest.init(validating:)),
                createdAt: TimestampMilliseconds(rawValue: row["created_at_ms"]),
                areaInputs: inputs,
                reasons: reasons,
                notices: notices
            )
        }

        let sessions = try Row.fetchAll(
            db,
            sql: "SELECT * FROM routine_sessions ORDER BY updated_at_ms, id"
        ).map { row in
            let bytes = Data((row["routine_snapshot_json"] as String).utf8)
            let checksum = try SHA256Digest(validating: row["snapshot_checksum"])
            let actual = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            guard checksum.rawValue == actual else { throw KineoPersistenceFailure.corruptStore }
            let snapshot = try OpaqueRoutineSnapshot(
                bytes: bytes,
                checksum: checksum,
                includedAreas: includedAreas(in: bytes)
            )
            return try RoutineSession(
                id: RoutineSessionID(validating: row["id"]),
                decisionID: SelectionDecisionID(validating: row["decision_id"]),
                checkInID: CheckInID(validating: row["check_in_id"]),
                status: requiredEnum(RoutineStatus.self, row["status"]),
                snapshot: snapshot,
                currentStepIndex: row["current_step_index"],
                stepElapsedMilliseconds: row["step_elapsed_ms"],
                startedAt: optionalTimestamp(row["started_at_ms"]),
                updatedAt: TimestampMilliseconds(rawValue: row["updated_at_ms"]),
                endedAt: optionalTimestamp(row["ended_at_ms"]),
                dayContext: dayContext(row)
            )
        }

        let decodedRoutineEvents = try Row.fetchAll(
            db,
            sql: "SELECT * FROM routine_events ORDER BY routine_session_id, sequence_number"
        ).map { row in
            let event = try RoutineEvent(
                id: RoutineEventID(validating: row["id"]),
                routineSessionID: RoutineSessionID(validating: row["routine_session_id"]),
                sequenceNumber: row["sequence_number"],
                kind: requiredEnum(RoutineEventKind.self, row["kind"]),
                stepID: try optionalNonEmpty(row["step_id"]),
                moduleID: try optionalNonEmpty(row["module_id"]),
                alternativeID: try optionalNonEmpty(row["alternative_id"]),
                localReason: optionalEnum(RoutineEventReason.self, row["local_reason_code"]),
                occurredAt: TimestampMilliseconds(rawValue: row["occurred_at_ms"])
            )
            let checkpoint = try RoutineCheckpoint(
                status: requiredEnum(RoutineStatus.self, row["resulting_status"]),
                currentStepIndex: row["resulting_step_index"],
                stepElapsedMilliseconds: row["resulting_step_elapsed_ms"],
                updatedAt: TimestampMilliseconds(rawValue: row["resulting_updated_at_ms"]),
                endedAt: optionalTimestamp(row["resulting_ended_at_ms"])
            )
            _ = try RecordRoutineEventCommand(event: event, checkpoint: checkpoint)
            return DecodedRoutineEvent(event: event, checkpoint: checkpoint)
        }
        try validateRoutineAudit(sessions: sessions, events: decodedRoutineEvents)
        let routineEvents = decodedRoutineEvents.map(\.event)

        let feedback = try Row.fetchAll(
            db,
            sql: "SELECT * FROM feedback_submissions ORDER BY submitted_at_ms, id"
        ).map { row in
            let id = try FeedbackSubmissionID(validating: row["id"])
            let responses = try Row.fetchAll(
                db,
                sql: "SELECT * FROM area_feedback WHERE feedback_submission_id = ? ORDER BY area",
                arguments: [id.rawValue]
            ).map { response in
                let childSubmittedAt: Int64 = response["submitted_at_ms"]
                let childLocalDay: String = response["local_day"]
                let childTimeZone: String = response["time_zone_id"]
                let childCalendar: String = response["calendar_id"]
                guard childSubmittedAt == (row["submitted_at_ms"] as Int64),
                      childLocalDay == (row["local_day"] as String),
                      childTimeZone == (row["time_zone_id"] as String),
                      childCalendar == (row["calendar_id"] as String) else {
                    throw KineoPersistenceFailure.corruptStore
                }
                return FeedbackResponse(
                    id: try AreaFeedbackID(validating: response["id"]),
                    area: try requiredEnum(BodyArea.self, response["area"]),
                    response: try requiredEnum(AreaResponse.self, response["response"])
                )
            }
            return try FeedbackSubmission(
                id: id,
                routineSessionID: RoutineSessionID(validating: row["routine_session_id"]),
                responses: responses,
                submittedAt: TimestampMilliseconds(rawValue: row["submitted_at_ms"]),
                dayContext: dayContext(row)
            )
        }

        return try KineoDataSnapshot(
            profileState: profileState,
            checkIns: checkIns,
            attentionStates: attentionStates,
            safetyEvents: safetyEvents,
            pauseTodayEvents: pauseEvents,
            decisions: decisions,
            routineSessions: sessions,
            routineEvents: routineEvents,
            feedbackSubmissions: feedback
        )
    }

    private static func decodeCheckInEntry(_ row: Row) throws -> CheckInEntry {
        try CheckInEntry(
            id: CheckInEntryID(validating: row["id"]),
            area: requiredEnum(BodyArea.self, row["area"]),
            role: requiredEnum(AreaRole.self, row["role"]),
            changeReport: requiredEnum(ChangeReport.self, row["change_report"]),
            movementComfort: requiredEnum(MovementComfort.self, row["movement_comfort"]),
            conditionalSafetyAnswer: optionalEnum(ConditionalSafetyAnswer.self, row["conditional_safety_answer"]),
            submittedAt: TimestampMilliseconds(rawValue: row["submitted_at_ms"])
        )
    }

    private static func dayContext(_ row: Row) throws -> LocalDayContext {
        guard let day = LocalDay(rawValue: row["local_day"]) else {
            throw KineoPersistenceFailure.corruptStore
        }
        return LocalDayContext(
            localDay: day,
            timeZoneID: try NonEmptyString(validating: row["time_zone_id"]),
            calendarID: try NonEmptyString(validating: row["calendar_id"])
        )
    }

    private static func optionalTimestamp(_ value: Int64?) -> TimestampMilliseconds? {
        value.map(TimestampMilliseconds.init(rawValue:))
    }

    private static func validateRoutineAudit(
        sessions: [RoutineSession],
        events: [DecodedRoutineEvent]
    ) throws {
        for session in sessions {
            let ordered = events
                .filter { $0.event.routineSessionID == session.id }
                .sorted { $0.event.sequenceNumber < $1.event.sequenceNumber }
            guard !ordered.isEmpty || session.status == .prepared else {
                throw KineoPersistenceFailure.corruptStore
            }
            var status = RoutineStatus.prepared
            var priorUpdatedAt: TimestampMilliseconds?
            var startedAt: TimestampMilliseconds?
            for item in ordered {
                guard isValidTransition(from: status, event: item.event.kind, to: item.checkpoint.status),
                      priorUpdatedAt.map({ item.checkpoint.updatedAt >= $0 }) ?? true else {
                    throw KineoPersistenceFailure.corruptStore
                }
                if item.event.kind == .started { startedAt = item.event.occurredAt }
                status = item.checkpoint.status
                priorUpdatedAt = item.checkpoint.updatedAt
            }
            guard let last = ordered.last else { continue }
            guard status == session.status,
                  startedAt == session.startedAt,
                  last.checkpoint.currentStepIndex == session.currentStepIndex,
                  last.checkpoint.stepElapsedMilliseconds == session.stepElapsedMilliseconds,
                  last.checkpoint.updatedAt == session.updatedAt,
                  last.checkpoint.endedAt == session.endedAt else {
                throw KineoPersistenceFailure.corruptStore
            }
        }
        guard events.allSatisfy({ event in
            sessions.contains { $0.id == event.event.routineSessionID }
        }) else {
            throw KineoPersistenceFailure.corruptStore
        }
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

    private static func optionalNonEmpty(_ value: String?) throws -> NonEmptyString? {
        try value.map { try NonEmptyString(validating: $0) }
    }

    private static func requiredEnum<E: RawRepresentable>(
        _ type: E.Type,
        _ rawValue: String
    ) throws -> E where E.RawValue == String {
        guard let value = E(rawValue: rawValue) else { throw KineoPersistenceFailure.corruptStore }
        return value
    }

    private static func optionalEnum<E: RawRepresentable>(
        _ type: E.Type,
        _ rawValue: String?
    ) throws -> E? where E.RawValue == String {
        guard let rawValue else { return nil }
        return try requiredEnum(type, rawValue)
    }
}

private struct DecodedRoutineEvent {
    let event: RoutineEvent
    let checkpoint: RoutineCheckpoint
}
