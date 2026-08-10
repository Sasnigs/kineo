import CryptoKit
import Foundation
import GRDB
import KineoCore

enum KineoDatabaseSchema {
    static let currentVersion = 1
    static let migrationName = "v1_initial"

    private static let millisecondsPerSecond = 1_000.0
    private static let lowercaseByteHexFormat = "%02x"
    private static let expectedMigrationRowCount = 1
    private static let onlyMigrationRowIndex = 0
    private static let unmigratedVersion = 0
    private static let gentleLevelRank = 0
    private static let balancedLevelRank = 1
    private static let activeLevelRank = 2

    static var migrationChecksum: String {
        let bytes = SHA256.hash(data: Data(statements.joined(separator: "\n").utf8))
        return bytes.map { String(format: lowercaseByteHexFormat, $0) }.joined()
    }

    static func migrator(
        failure: KineoStoreFailureInjection,
        appliedAtMilliseconds: Int64 = Int64(Date().timeIntervalSince1970 * millisecondsPerSecond)
    ) -> DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.eraseDatabaseOnSchemaChange = false
        migrator.registerMigration(migrationName) { db in
            for (index, statement) in statements.enumerated() {
                try db.execute(sql: statement)
                try failure.check(.migrationStatement(index))
            }
            try db.execute(
                sql: """
                INSERT INTO schema_migrations(version, name, checksum, applied_at_ms)
                VALUES (?, ?, ?, ?)
                """,
                arguments: [currentVersion, migrationName, migrationChecksum, appliedAtMilliseconds]
            )
            try db.execute(sql: "PRAGMA user_version = \(currentVersion)")
            try failure.check(.migrationBeforeCommit)
        }
        return migrator
    }

    static func preflight(_ db: Database) throws {
        let version = try Int.fetchOne(db, sql: "PRAGMA user_version") ?? unmigratedVersion
        guard version <= currentVersion else {
            throw KineoPersistenceFailure.futureSchema(version)
        }

        guard try db.tableExists("schema_migrations") else {
            guard version == unmigratedVersion else {
                throw KineoPersistenceFailure.migrationIntegrity
            }
            return
        }

        let rows = try Row.fetchAll(
            db,
            sql: "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
        )
        guard rows.count == expectedMigrationRowCount,
              rows[onlyMigrationRowIndex]["version"] == currentVersion,
              rows[onlyMigrationRowIndex]["name"] == migrationName,
              rows[onlyMigrationRowIndex]["checksum"] == migrationChecksum,
              version == currentVersion
        else {
            throw KineoPersistenceFailure.migrationIntegrity
        }
    }

    static let statements: [String] = [
        """
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY CHECK (version > 0),
            name TEXT NOT NULL CHECK (length(name) > 0),
            checksum TEXT NOT NULL CHECK (length(checksum) = \(SHA256Digest.encodedLength)),
            applied_at_ms INTEGER NOT NULL
        )
        """,
        """
        CREATE TABLE user_profile (
            singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
            onboarding_completed_at_ms INTEGER,
            adult_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (adult_acknowledged IN (0, 1)),
            safety_boundary_version TEXT,
            safety_acknowledged_at_ms INTEGER,
            primary_area TEXT CHECK (primary_area IN ('neck', 'upperMidBack', 'lowerBack')),
            secondary_area TEXT CHECK (secondary_area IN ('neck', 'upperMidBack', 'lowerBack')),
            routine_preference TEXT,
            weekly_goal_days INTEGER NOT NULL DEFAULT \(UserProfile.defaultWeeklyGoalDays)
                CHECK (weekly_goal_days BETWEEN \(UserProfile.minimumWeeklyGoalDays)
                    AND \(UserProfile.maximumWeeklyGoalDays)),
            telemetry_choice TEXT NOT NULL DEFAULT 'notOffered'
                CHECK (telemetry_choice IN ('notOffered', 'declined', 'optedIn')),
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            CHECK (secondary_area IS NULL OR secondary_area <> primary_area),
            CHECK (
                onboarding_completed_at_ms IS NULL OR
                (adult_acknowledged = 1 AND primary_area IS NOT NULL AND
                 safety_boundary_version IS NOT NULL AND length(safety_boundary_version) > 0 AND
                 safety_acknowledged_at_ms IS NOT NULL)
            )
        )
        """,
        """
        CREATE TABLE reminder_settings (
            singleton_id INTEGER PRIMARY KEY REFERENCES user_profile(singleton_id) ON DELETE CASCADE
                CHECK (singleton_id = 1),
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            window_start_minutes INTEGER CHECK (window_start_minutes BETWEEN
                \(ReminderWindow.firstStartMinute) AND \(ReminderWindow.lastStartMinute)),
            window_end_minutes INTEGER CHECK (window_end_minutes BETWEEN
                \(ReminderWindow.firstEndMinute) AND \(ReminderWindow.endOfDayMinute)),
            time_zone_id TEXT,
            updated_at_ms INTEGER NOT NULL,
            CHECK (
                enabled = 0 OR
                (enabled = 1 AND window_start_minutes IS NOT NULL AND window_end_minutes IS NOT NULL AND
                 window_end_minutes > window_start_minutes)
            )
        )
        """,
        """
        CREATE TABLE check_ins (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'abandoned')),
            purpose TEXT NOT NULL CHECK (purpose IN ('normal', 'attentionCorrection')),
            primary_area TEXT NOT NULL CHECK (primary_area IN ('neck', 'upperMidBack', 'lowerBack')),
            secondary_area TEXT CHECK (secondary_area IN ('neck', 'upperMidBack', 'lowerBack')),
            correction_area TEXT CHECK (correction_area IN ('neck', 'upperMidBack', 'lowerBack')),
            source_triggering_entry_id TEXT REFERENCES check_in_entries(id) ON DELETE SET NULL,
            started_at_ms INTEGER NOT NULL,
            completed_at_ms INTEGER,
            local_day TEXT NOT NULL CHECK (length(local_day) = \(LocalDay.encodedLength)),
            time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
            calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
            CHECK (secondary_area IS NULL OR secondary_area <> primary_area),
            CHECK ((status = 'completed' AND completed_at_ms IS NOT NULL) OR
                   (status <> 'completed' AND completed_at_ms IS NULL)),
            CHECK ((purpose = 'normal' AND correction_area IS NULL AND source_triggering_entry_id IS NULL) OR
                   (purpose = 'attentionCorrection' AND correction_area IS NOT NULL))
        )
        """,
        """
        CREATE TABLE check_in_entries (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            check_in_id TEXT NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
            area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
            role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
            change_report TEXT NOT NULL CHECK (change_report IN ('better', 'similar', 'worse')),
            movement_comfort TEXT NOT NULL CHECK (movement_comfort IN ('limited', 'okay', 'good')),
            conditional_safety_answer TEXT CHECK (conditional_safety_answer IN ('no', 'yes', 'notSure')),
            submitted_at_ms INTEGER NOT NULL,
            UNIQUE(check_in_id, area),
            CHECK (
                ((change_report = 'worse' OR movement_comfort = 'limited') AND conditional_safety_answer IS NOT NULL) OR
                ((change_report <> 'worse' AND movement_comfort <> 'limited') AND conditional_safety_answer IS NULL)
            )
        )
        """,
        """
        CREATE TABLE safety_events (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
            kind TEXT NOT NULL CHECK (kind IN (
                'attentionEntered', 'attentionClearedReturnedToUsual', 'attentionClearedCorrection',
                'attentionReaffirmed', 'attentionReaffirmedCorrection'
            )),
            source_check_in_entry_id TEXT REFERENCES check_in_entries(id) ON DELETE SET NULL,
            return_answer TEXT CHECK (return_answer IN ('no', 'yes', 'notSure')),
            occurred_at_ms INTEGER NOT NULL,
            local_day TEXT NOT NULL CHECK (length(local_day) = \(LocalDay.encodedLength)),
            time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
            calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
            CHECK (
                (kind IN ('attentionEntered', 'attentionClearedCorrection', 'attentionReaffirmedCorrection') AND
                 source_check_in_entry_id IS NOT NULL AND return_answer IS NULL) OR
                (kind = 'attentionClearedReturnedToUsual' AND source_check_in_entry_id IS NULL AND return_answer = 'yes') OR
                (kind = 'attentionReaffirmed' AND source_check_in_entry_id IS NULL AND return_answer IN ('no', 'notSure'))
            )
        )
        """,
        """
        CREATE TABLE attention_states (
            area TEXT PRIMARY KEY CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
            updated_at_ms INTEGER NOT NULL
        )
        """,
        """
        CREATE TABLE pause_today_events (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            check_in_id TEXT NOT NULL UNIQUE REFERENCES check_ins(id) ON DELETE CASCADE,
            chosen_at_ms INTEGER NOT NULL,
            local_day TEXT NOT NULL CHECK (length(local_day) = \(LocalDay.encodedLength)),
            time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
            calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0)
        )
        """,
        """
        CREATE TABLE selection_decisions (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            check_in_id TEXT NOT NULL REFERENCES check_ins(id) ON DELETE RESTRICT,
            revision INTEGER NOT NULL CHECK (revision >= 1),
            rules_version TEXT NOT NULL CHECK (length(rules_version) > 0),
            catalog_version_requested TEXT NOT NULL CHECK (length(catalog_version_requested) > 0),
            catalog_version_delivered TEXT,
            outcome TEXT NOT NULL CHECK (outcome IN ('selected', 'contentUnavailable')),
            recommended_level TEXT NOT NULL CHECK (recommended_level IN ('gentle', 'balanced', 'active')),
            requested_override TEXT CHECK (requested_override IN ('gentle', 'balanced', 'active')),
            override_disposition TEXT NOT NULL CHECK (override_disposition IN ('none', 'acceptedGentler', 'sameAsRecommended', 'rejectedHigher')),
            selected_level TEXT NOT NULL CHECK (selected_level IN ('gentle', 'balanced', 'active')),
            delivered_level TEXT CHECK (delivered_level IN ('gentle', 'balanced', 'active')),
            duration_variant TEXT NOT NULL CHECK (duration_variant IN ('quick', 'standard')),
            secondary_omission_reason TEXT CHECK (secondary_omission_reason IN ('secondaryUnanswered', 'catalogIncompatible', 'contentUnavailable')),
            validation_result TEXT NOT NULL CHECK (validation_result IN ('exact', 'fallback', 'unavailable')),
            primary_template_id TEXT,
            primary_template_revision INTEGER CHECK (primary_template_revision >= 1),
            secondary_module_id TEXT,
            secondary_module_revision INTEGER CHECK (secondary_module_revision >= 1),
            compatibility_rule_id TEXT,
            composition_fingerprint TEXT,
            created_at_ms INTEGER NOT NULL,
            UNIQUE(check_in_id, revision),
            CHECK (
                CASE selected_level WHEN 'gentle' THEN \(gentleLevelRank)
                    WHEN 'balanced' THEN \(balancedLevelRank) ELSE \(activeLevelRank) END <=
                CASE recommended_level WHEN 'gentle' THEN \(gentleLevelRank)
                    WHEN 'balanced' THEN \(balancedLevelRank) ELSE \(activeLevelRank) END
            ),
            CHECK (
                delivered_level IS NULL OR
                CASE delivered_level WHEN 'gentle' THEN \(gentleLevelRank)
                    WHEN 'balanced' THEN \(balancedLevelRank) ELSE \(activeLevelRank) END <=
                CASE selected_level WHEN 'gentle' THEN \(gentleLevelRank)
                    WHEN 'balanced' THEN \(balancedLevelRank) ELSE \(activeLevelRank) END
            ),
            CHECK ((secondary_module_id IS NULL AND secondary_module_revision IS NULL) OR
                   (secondary_module_id IS NOT NULL AND secondary_module_revision IS NOT NULL AND compatibility_rule_id IS NOT NULL)),
            CHECK (
                (outcome = 'selected' AND catalog_version_delivered IS NOT NULL AND delivered_level IS NOT NULL AND
                 primary_template_id IS NOT NULL AND primary_template_revision IS NOT NULL AND
                 composition_fingerprint IS NOT NULL AND
                 length(composition_fingerprint) = \(SHA256Digest.encodedLength) AND
                 validation_result IN ('exact', 'fallback')) OR
                (outcome = 'contentUnavailable' AND catalog_version_delivered IS NULL AND delivered_level IS NULL AND
                 primary_template_id IS NULL AND primary_template_revision IS NULL AND
                 secondary_module_id IS NULL AND secondary_module_revision IS NULL AND compatibility_rule_id IS NULL AND
                 composition_fingerprint IS NULL AND validation_result = 'unavailable')
            )
        )
        """,
        """
        CREATE TABLE decision_area_inputs (
            decision_id TEXT NOT NULL REFERENCES selection_decisions(id) ON DELETE CASCADE,
            area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
            role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
            check_in_entry_id TEXT NOT NULL REFERENCES check_in_entries(id) ON DELETE RESTRICT,
            base_level TEXT NOT NULL CHECK (base_level IN ('gentle', 'balanced', 'active')),
            active_unlocked INTEGER NOT NULL CHECK (active_unlocked IN (0, 1)),
            qualifying_count INTEGER NOT NULL CHECK (qualifying_count >= 0),
            latest_response TEXT CHECK (latest_response IN ('better', 'same', 'worse')),
            included INTEGER NOT NULL CHECK (included IN (0, 1)),
            PRIMARY KEY(decision_id, area)
        )
        """,
        """
        CREATE TABLE decision_reasons (
            decision_id TEXT NOT NULL REFERENCES selection_decisions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK (kind IN ('selection', 'presented')),
            position INTEGER NOT NULL CHECK (position IN (0, 1)),
            reason_code TEXT NOT NULL CHECK (length(reason_code) > 0),
            parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
            PRIMARY KEY(decision_id, kind, position)
        )
        """,
        """
        CREATE TABLE decision_notices (
            decision_id TEXT NOT NULL REFERENCES selection_decisions(id) ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK (position >= 0),
            notice_code TEXT NOT NULL CHECK (length(notice_code) > 0),
            area TEXT CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
            parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
            PRIMARY KEY(decision_id, position)
        )
        """,
        """
        CREATE TABLE routine_sessions (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            decision_id TEXT NOT NULL UNIQUE REFERENCES selection_decisions(id) ON DELETE RESTRICT,
            check_in_id TEXT NOT NULL UNIQUE REFERENCES check_ins(id) ON DELETE RESTRICT,
            status TEXT NOT NULL CHECK (status IN ('prepared', 'inProgress', 'paused', 'completed', 'stopped', 'safetyStopped', 'abandoned')),
            routine_snapshot_json TEXT NOT NULL CHECK (json_valid(routine_snapshot_json)),
            snapshot_checksum TEXT NOT NULL
                CHECK (length(snapshot_checksum) = \(SHA256Digest.encodedLength)),
            current_step_index INTEGER NOT NULL CHECK (current_step_index >= 0),
            step_elapsed_ms INTEGER NOT NULL CHECK (step_elapsed_ms >= 0),
            started_at_ms INTEGER,
            updated_at_ms INTEGER NOT NULL,
            ended_at_ms INTEGER,
            local_day TEXT NOT NULL CHECK (length(local_day) = \(LocalDay.encodedLength)),
            time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
            calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
            CHECK ((status IN ('completed', 'stopped', 'safetyStopped', 'abandoned') AND ended_at_ms IS NOT NULL) OR
                   (status IN ('prepared', 'inProgress', 'paused') AND ended_at_ms IS NULL))
        )
        """,
        """
        CREATE TABLE routine_events (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            routine_session_id TEXT NOT NULL REFERENCES routine_sessions(id) ON DELETE CASCADE,
            sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
            kind TEXT NOT NULL CHECK (kind IN ('started', 'paused', 'resumed', 'stepCompleted', 'skipped', 'alternativeSelected', 'stopped', 'safetyStopped', 'completed', 'abandoned')),
            step_id TEXT,
            module_id TEXT,
            alternative_id TEXT,
            local_reason_code TEXT CHECK (local_reason_code IN ('uncomfortable', 'unclear', 'notEnoughSpace')),
            occurred_at_ms INTEGER NOT NULL,
            resulting_status TEXT NOT NULL CHECK (resulting_status IN ('prepared', 'inProgress', 'paused', 'completed', 'stopped', 'safetyStopped', 'abandoned')),
            resulting_step_index INTEGER NOT NULL CHECK (resulting_step_index >= 0),
            resulting_step_elapsed_ms INTEGER NOT NULL CHECK (resulting_step_elapsed_ms >= 0),
            resulting_updated_at_ms INTEGER NOT NULL,
            resulting_ended_at_ms INTEGER,
            UNIQUE(routine_session_id, sequence_number),
            CHECK ((step_id IS NULL AND module_id IS NULL) OR (step_id IS NOT NULL AND module_id IS NOT NULL)),
            CHECK ((kind = 'alternativeSelected' AND alternative_id IS NOT NULL AND step_id IS NOT NULL) OR
                   (kind <> 'alternativeSelected' AND alternative_id IS NULL)),
            CHECK ((kind IN ('stepCompleted', 'skipped', 'alternativeSelected') AND step_id IS NOT NULL) OR
                   (kind NOT IN ('stepCompleted', 'skipped', 'alternativeSelected')))
        )
        """,
        """
        CREATE TABLE feedback_submissions (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            routine_session_id TEXT NOT NULL UNIQUE REFERENCES routine_sessions(id) ON DELETE CASCADE,
            submitted_at_ms INTEGER NOT NULL,
            local_day TEXT NOT NULL CHECK (length(local_day) = \(LocalDay.encodedLength)),
            time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
            calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0)
        )
        """,
        """
        CREATE TABLE area_feedback (
            id TEXT PRIMARY KEY CHECK (length(id) > 0),
            feedback_submission_id TEXT NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
            area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
            response TEXT NOT NULL CHECK (response IN ('better', 'same', 'worse')),
            submitted_at_ms INTEGER NOT NULL,
            local_day TEXT NOT NULL CHECK (length(local_day) = \(LocalDay.encodedLength)),
            time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
            calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
            UNIQUE(feedback_submission_id, area)
        )
        """,
        "CREATE INDEX check_ins_chronology ON check_ins(local_day, completed_at_ms)",
        "CREATE UNIQUE INDEX check_in_entries_area ON check_in_entries(check_in_id, area)",
        "CREATE INDEX safety_events_chronology ON safety_events(area, occurred_at_ms DESC)",
        "CREATE INDEX pause_today_events_chronology ON pause_today_events(local_day, chosen_at_ms)",
        "CREATE INDEX decision_area_inputs_history ON decision_area_inputs(area, decision_id)",
        "CREATE INDEX routine_sessions_chronology ON routine_sessions(local_day, ended_at_ms)",
        "CREATE INDEX routine_sessions_status ON routine_sessions(status)",
        "CREATE UNIQUE INDEX one_nonterminal_routine ON routine_sessions((1)) WHERE status IN ('prepared', 'inProgress', 'paused')",
        "CREATE INDEX area_feedback_chronology ON area_feedback(area, submitted_at_ms)",
        "CREATE UNIQUE INDEX feedback_submissions_session ON feedback_submissions(routine_session_id)",
        "CREATE UNIQUE INDEX routine_events_sequence ON routine_events(routine_session_id, sequence_number)"
    ]
}
