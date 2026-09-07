import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

import type {
  PersistenceError,
  PersistenceResult,
  SqliteDatabase,
  SqliteExecutor,
} from '../../core/persistence/persistence-contract';

export const kineoSchemaVersion = 5;
export const kineoInitialMigrationName = 'v1_initial';
export const kineoV2MigrationName = 'v2_account_sync';
export const kineoV3MigrationName = 'v3_account_hydration';
export const kineoV4MigrationName = 'v4_complete_sync_outbox';

const unmigratedSchemaVersion = 0;
const initialSchemaVersion = 1;
const accountSyncSchemaVersion = 2;
const accountHydrationSchemaVersion = 3;
const completeSyncOutboxSchemaVersion = 4;
const verifiedHydrationSchemaVersion = 5;
const singletonProfileId = 1;
const minimumWeeklyGoalDays = 1;
const maximumWeeklyGoalDays = 7;
const defaultWeeklyGoalDays = 3;
const firstMinuteOfDay = 0;
const lastStartMinuteOfDay = 1_439;
const firstEndMinuteOfDay = 1;
const endMinuteOfDay = 1_440;
const localDayTextLength = 10;
const sha256HexLength = 64;
const firstRevision = 1;
const firstSequenceNumber = 1;
const firstReasonPosition = 0;
const secondReasonPosition = 1;
const gentleLevelRank = 0;
const balancedLevelRank = 1;
const activeLevelRank = 2;

export const kineoV1MigrationStatements = Object.freeze([
  `CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > ${unmigratedSchemaVersion}),
    name TEXT NOT NULL CHECK (length(name) > 0),
    checksum TEXT NOT NULL CHECK (length(checksum) = ${sha256HexLength}),
    applied_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE user_profile (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = ${singletonProfileId}),
    onboarding_completed_at_ms INTEGER,
    adult_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (adult_acknowledged IN (0, 1)),
    safety_boundary_version TEXT,
    safety_acknowledged_at_ms INTEGER,
    primary_area TEXT CHECK (primary_area IN ('neck', 'upperMidBack', 'lowerBack')),
    secondary_area TEXT CHECK (secondary_area IN ('neck', 'upperMidBack', 'lowerBack')),
    routine_preference TEXT,
    weekly_goal_days INTEGER NOT NULL DEFAULT ${defaultWeeklyGoalDays}
      CHECK (weekly_goal_days BETWEEN ${minimumWeeklyGoalDays} AND ${maximumWeeklyGoalDays}),
    telemetry_choice TEXT NOT NULL DEFAULT 'notOffered'
      CHECK (telemetry_choice IN ('notOffered', 'declined', 'optedIn')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK (secondary_area IS NULL OR secondary_area <> primary_area),
    CHECK (onboarding_completed_at_ms IS NULL OR
      (adult_acknowledged = 1 AND primary_area IS NOT NULL AND
       safety_boundary_version IS NOT NULL AND length(safety_boundary_version) > 0 AND
       safety_acknowledged_at_ms IS NOT NULL))
  )`,
  `CREATE TABLE reminder_settings (
    singleton_id INTEGER PRIMARY KEY REFERENCES user_profile(singleton_id) ON DELETE CASCADE
      CHECK (singleton_id = ${singletonProfileId}),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    window_start_minutes INTEGER CHECK (window_start_minutes BETWEEN ${firstMinuteOfDay} AND ${lastStartMinuteOfDay}),
    window_end_minutes INTEGER CHECK (window_end_minutes BETWEEN ${firstEndMinuteOfDay} AND ${endMinuteOfDay}),
    time_zone_id TEXT,
    updated_at_ms INTEGER NOT NULL,
    CHECK (enabled = 0 OR
      (enabled = 1 AND window_start_minutes IS NOT NULL AND window_end_minutes IS NOT NULL AND
       window_end_minutes > window_start_minutes))
  )`,
  `CREATE TABLE check_ins (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'abandoned')),
    purpose TEXT NOT NULL CHECK (purpose IN ('normal', 'attentionCorrection')),
    primary_area TEXT NOT NULL CHECK (primary_area IN ('neck', 'upperMidBack', 'lowerBack')),
    secondary_area TEXT CHECK (secondary_area IN ('neck', 'upperMidBack', 'lowerBack')),
    correction_area TEXT CHECK (correction_area IN ('neck', 'upperMidBack', 'lowerBack')),
    source_triggering_entry_id TEXT REFERENCES check_in_entries(id) ON DELETE SET NULL,
    started_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    local_day TEXT NOT NULL CHECK (length(local_day) = ${localDayTextLength}),
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
    calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
    CHECK (secondary_area IS NULL OR secondary_area <> primary_area),
    CHECK ((status = 'completed' AND completed_at_ms IS NOT NULL) OR
           (status <> 'completed' AND completed_at_ms IS NULL)),
    CHECK ((purpose = 'normal' AND correction_area IS NULL AND source_triggering_entry_id IS NULL) OR
           (purpose = 'attentionCorrection' AND correction_area IS NOT NULL))
  )`,
  `CREATE TABLE check_in_entries (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    check_in_id TEXT NOT NULL REFERENCES check_ins(id) ON DELETE CASCADE,
    area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
    role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
    change_report TEXT NOT NULL CHECK (change_report IN ('better', 'similar', 'worse')),
    movement_comfort TEXT NOT NULL CHECK (movement_comfort IN ('limited', 'okay', 'good')),
    conditional_safety_answer TEXT CHECK (conditional_safety_answer IN ('no', 'yes', 'notSure')),
    submitted_at_ms INTEGER NOT NULL,
    UNIQUE(check_in_id, area),
    CHECK ((((change_report = 'worse' OR movement_comfort = 'limited') AND conditional_safety_answer IS NOT NULL)) OR
           ((change_report <> 'worse' AND movement_comfort <> 'limited') AND conditional_safety_answer IS NULL))
  )`,
  `CREATE TABLE safety_events (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
    kind TEXT NOT NULL CHECK (kind IN ('attentionEntered', 'attentionClearedReturnedToUsual',
      'attentionClearedCorrection', 'attentionReaffirmed', 'attentionReaffirmedCorrection')),
    source_check_in_entry_id TEXT REFERENCES check_in_entries(id) ON DELETE SET NULL,
    return_answer TEXT CHECK (return_answer IN ('no', 'yes', 'notSure')),
    occurred_at_ms INTEGER NOT NULL,
    local_day TEXT NOT NULL CHECK (length(local_day) = ${localDayTextLength}),
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
    calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
    CHECK ((kind IN ('attentionEntered', 'attentionClearedCorrection', 'attentionReaffirmedCorrection') AND
            source_check_in_entry_id IS NOT NULL AND return_answer IS NULL) OR
           (kind = 'attentionClearedReturnedToUsual' AND source_check_in_entry_id IS NULL AND return_answer = 'yes') OR
           (kind = 'attentionReaffirmed' AND source_check_in_entry_id IS NULL AND return_answer IN ('no', 'notSure')))
  )`,
  `CREATE TABLE attention_states (
    area TEXT PRIMARY KEY CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE TABLE pause_today_events (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    check_in_id TEXT NOT NULL UNIQUE REFERENCES check_ins(id) ON DELETE CASCADE,
    chosen_at_ms INTEGER NOT NULL,
    local_day TEXT NOT NULL CHECK (length(local_day) = ${localDayTextLength}),
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
    calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0)
  )`,
  `CREATE TABLE selection_decisions (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    check_in_id TEXT NOT NULL REFERENCES check_ins(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK (revision >= ${firstRevision}),
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
    primary_template_revision INTEGER CHECK (primary_template_revision >= ${firstRevision}),
    secondary_module_id TEXT,
    secondary_module_revision INTEGER CHECK (secondary_module_revision >= ${firstRevision}),
    compatibility_rule_id TEXT,
    composition_fingerprint TEXT,
    created_at_ms INTEGER NOT NULL,
    UNIQUE(check_in_id, revision),
    CHECK (CASE selected_level WHEN 'gentle' THEN ${gentleLevelRank}
      WHEN 'balanced' THEN ${balancedLevelRank} ELSE ${activeLevelRank} END <=
      CASE recommended_level WHEN 'gentle' THEN ${gentleLevelRank}
      WHEN 'balanced' THEN ${balancedLevelRank} ELSE ${activeLevelRank} END),
    CHECK (delivered_level IS NULL OR
      CASE delivered_level WHEN 'gentle' THEN ${gentleLevelRank}
        WHEN 'balanced' THEN ${balancedLevelRank} ELSE ${activeLevelRank} END <=
      CASE selected_level WHEN 'gentle' THEN ${gentleLevelRank}
        WHEN 'balanced' THEN ${balancedLevelRank} ELSE ${activeLevelRank} END),
    CHECK ((secondary_module_id IS NULL AND secondary_module_revision IS NULL) OR
      (secondary_module_id IS NOT NULL AND secondary_module_revision IS NOT NULL AND compatibility_rule_id IS NOT NULL)),
    CHECK ((outcome = 'selected' AND catalog_version_delivered IS NOT NULL AND delivered_level IS NOT NULL AND
      primary_template_id IS NOT NULL AND primary_template_revision IS NOT NULL AND
      composition_fingerprint IS NOT NULL AND length(composition_fingerprint) = ${sha256HexLength} AND
      validation_result IN ('exact', 'fallback')) OR
      (outcome = 'contentUnavailable' AND catalog_version_delivered IS NULL AND delivered_level IS NULL AND
      primary_template_id IS NULL AND primary_template_revision IS NULL AND secondary_module_id IS NULL AND
      secondary_module_revision IS NULL AND compatibility_rule_id IS NULL AND composition_fingerprint IS NULL AND
      validation_result = 'unavailable'))
  )`,
  `CREATE TABLE decision_area_inputs (
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
  )`,
  `CREATE TABLE decision_reasons (
    decision_id TEXT NOT NULL REFERENCES selection_decisions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('selection', 'presented')),
    position INTEGER NOT NULL CHECK (position IN (${firstReasonPosition}, ${secondReasonPosition})),
    reason_code TEXT NOT NULL CHECK (length(reason_code) > 0),
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    PRIMARY KEY(decision_id, kind, position)
  )`,
  `CREATE TABLE decision_notices (
    decision_id TEXT NOT NULL REFERENCES selection_decisions(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= ${firstReasonPosition}),
    notice_code TEXT NOT NULL CHECK (length(notice_code) > 0),
    area TEXT CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    PRIMARY KEY(decision_id, position)
  )`,
  `CREATE TABLE routine_sessions (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    decision_id TEXT NOT NULL UNIQUE REFERENCES selection_decisions(id) ON DELETE RESTRICT,
    check_in_id TEXT NOT NULL UNIQUE REFERENCES check_ins(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('prepared', 'inProgress', 'paused', 'completed', 'stopped', 'safetyStopped', 'abandoned')),
    routine_snapshot_json TEXT NOT NULL CHECK (json_valid(routine_snapshot_json)),
    snapshot_checksum TEXT NOT NULL CHECK (length(snapshot_checksum) = ${sha256HexLength}),
    current_step_index INTEGER NOT NULL CHECK (current_step_index >= ${firstReasonPosition}),
    step_elapsed_ms INTEGER NOT NULL CHECK (step_elapsed_ms >= ${firstReasonPosition}),
    started_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    ended_at_ms INTEGER,
    local_day TEXT NOT NULL CHECK (length(local_day) = ${localDayTextLength}),
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
    calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
    CHECK ((status IN ('completed', 'stopped', 'safetyStopped', 'abandoned') AND ended_at_ms IS NOT NULL) OR
      (status IN ('prepared', 'inProgress', 'paused') AND ended_at_ms IS NULL))
  )`,
  `CREATE TABLE routine_events (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    routine_session_id TEXT NOT NULL REFERENCES routine_sessions(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL CHECK (sequence_number >= ${firstSequenceNumber}),
    kind TEXT NOT NULL CHECK (kind IN ('started', 'paused', 'resumed', 'stepCompleted', 'skipped',
      'alternativeSelected', 'stopped', 'safetyStopped', 'completed', 'abandoned')),
    step_id TEXT,
    module_id TEXT,
    alternative_id TEXT,
    local_reason_code TEXT CHECK (local_reason_code IN ('uncomfortable', 'unclear', 'notEnoughSpace')),
    occurred_at_ms INTEGER NOT NULL,
    resulting_status TEXT NOT NULL CHECK (resulting_status IN ('prepared', 'inProgress', 'paused', 'completed', 'stopped', 'safetyStopped', 'abandoned')),
    resulting_step_index INTEGER NOT NULL CHECK (resulting_step_index >= ${firstReasonPosition}),
    resulting_step_elapsed_ms INTEGER NOT NULL CHECK (resulting_step_elapsed_ms >= ${firstReasonPosition}),
    resulting_updated_at_ms INTEGER NOT NULL,
    resulting_ended_at_ms INTEGER,
    UNIQUE(routine_session_id, sequence_number),
    CHECK ((step_id IS NULL AND module_id IS NULL) OR (step_id IS NOT NULL AND module_id IS NOT NULL)),
    CHECK ((kind = 'alternativeSelected' AND alternative_id IS NOT NULL AND step_id IS NOT NULL) OR
      (kind <> 'alternativeSelected' AND alternative_id IS NULL)),
    CHECK ((kind IN ('stepCompleted', 'skipped', 'alternativeSelected') AND step_id IS NOT NULL) OR
      (kind NOT IN ('stepCompleted', 'skipped', 'alternativeSelected')))
  )`,
  `CREATE TABLE feedback_submissions (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    routine_session_id TEXT NOT NULL UNIQUE REFERENCES routine_sessions(id) ON DELETE CASCADE,
    submitted_at_ms INTEGER NOT NULL,
    local_day TEXT NOT NULL CHECK (length(local_day) = ${localDayTextLength}),
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
    calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0)
  )`,
  `CREATE TABLE area_feedback (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    feedback_submission_id TEXT NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
    area TEXT NOT NULL CHECK (area IN ('neck', 'upperMidBack', 'lowerBack')),
    response TEXT NOT NULL CHECK (response IN ('better', 'same', 'worse')),
    submitted_at_ms INTEGER NOT NULL,
    local_day TEXT NOT NULL CHECK (length(local_day) = ${localDayTextLength}),
    time_zone_id TEXT NOT NULL CHECK (length(time_zone_id) > 0),
    calendar_id TEXT NOT NULL CHECK (length(calendar_id) > 0),
    UNIQUE(feedback_submission_id, area)
  )`,
  'CREATE INDEX check_ins_chronology ON check_ins(local_day, completed_at_ms)',
  'CREATE UNIQUE INDEX check_in_entries_area ON check_in_entries(check_in_id, area)',
  'CREATE INDEX safety_events_chronology ON safety_events(area, occurred_at_ms DESC)',
  'CREATE INDEX pause_today_events_chronology ON pause_today_events(local_day, chosen_at_ms)',
  'CREATE INDEX decision_area_inputs_history ON decision_area_inputs(area, decision_id)',
  'CREATE INDEX routine_sessions_chronology ON routine_sessions(local_day, ended_at_ms)',
  'CREATE INDEX routine_sessions_status ON routine_sessions(status)',
  "CREATE UNIQUE INDEX one_nonterminal_routine ON routine_sessions((1)) WHERE status IN ('prepared', 'inProgress', 'paused')",
  'CREATE INDEX area_feedback_chronology ON area_feedback(area, submitted_at_ms)',
  'CREATE UNIQUE INDEX feedback_submissions_session ON feedback_submissions(routine_session_id)',
  'CREATE UNIQUE INDEX routine_events_sequence ON routine_events(routine_session_id, sequence_number)',
] as const);

export const kineoV1MigrationChecksum = bytesToHex(
  sha256(utf8ToBytes(kineoV1MigrationStatements.join('\n'))),
);

export const kineoV2MigrationStatements = Object.freeze([
  'DELETE FROM area_feedback',
  'DELETE FROM feedback_submissions',
  'DELETE FROM routine_events',
  'DELETE FROM routine_sessions',
  'DELETE FROM decision_notices',
  'DELETE FROM decision_reasons',
  'DELETE FROM decision_area_inputs',
  'DELETE FROM pause_today_events',
  'DELETE FROM selection_decisions',
  'DELETE FROM safety_events',
  'DELETE FROM attention_states',
  'DELETE FROM check_in_entries',
  'DELETE FROM check_ins',
  'DELETE FROM reminder_settings',
  'DELETE FROM user_profile',
  `CREATE TABLE local_account_state (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = ${singletonProfileId}),
    account_id TEXT NOT NULL CHECK (length(account_id) > 0),
    installation_id TEXT NOT NULL CHECK (length(installation_id) > 0),
    account_status TEXT NOT NULL CHECK (account_status IN ('active', 'deleting')),
    history_epoch INTEGER NOT NULL CHECK (history_epoch >= ${firstRevision}),
    sync_cursor TEXT,
    last_synced_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE(account_id, installation_id)
  )`,
  `CREATE TABLE sync_outbox (
    mutation_id TEXT PRIMARY KEY CHECK (length(mutation_id) > 0),
    account_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    history_epoch INTEGER NOT NULL CHECK (history_epoch >= ${firstRevision}),
    command_kind TEXT NOT NULL CHECK (command_kind IN (
      'acceptLegal', 'saveProfile', 'submitCheckIn', 'applyAttentionTransition',
      'startRoutine', 'recordRoutineEvent', 'submitFeedback', 'resetHistory'
    )),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at_ms INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= ${unmigratedSchemaVersion}),
    next_attempt_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'conflict')),
    last_error_code TEXT,
    FOREIGN KEY(account_id, installation_id)
      REFERENCES local_account_state(account_id, installation_id)
      ON DELETE CASCADE
  )`,
  `CREATE INDEX sync_outbox_delivery
    ON sync_outbox(state, next_attempt_at_ms, created_at_ms)`,
] as const);

export const kineoV2MigrationChecksum = bytesToHex(
  sha256(utf8ToBytes(kineoV2MigrationStatements.join('\n'))),
);

export const kineoV3MigrationStatements = Object.freeze([
  `CREATE UNIQUE INDEX local_account_owner
    ON local_account_state(account_id)`,
  `CREATE TABLE local_legal_acceptances (
    account_id TEXT NOT NULL,
    document_kind TEXT NOT NULL CHECK (document_kind IN ('termsOfService', 'privacyPolicy')),
    document_version TEXT NOT NULL CHECK (length(document_version) > 0),
    locale TEXT NOT NULL CHECK (length(locale) > 0),
    accepted_at_ms INTEGER NOT NULL,
    PRIMARY KEY(account_id, document_kind, document_version),
    FOREIGN KEY(account_id) REFERENCES local_account_state(account_id) ON DELETE CASCADE
  )`,
  `CREATE TABLE synchronized_entities (
    account_id TEXT NOT NULL,
    entity_kind TEXT NOT NULL CHECK (length(entity_kind) > 0),
    entity_id TEXT NOT NULL CHECK (length(entity_id) > 0),
    payload_json TEXT,
    cursor TEXT NOT NULL CHECK (length(cursor) > 0),
    PRIMARY KEY(account_id, entity_kind, entity_id),
    FOREIGN KEY(account_id) REFERENCES local_account_state(account_id) ON DELETE CASCADE,
    CHECK (payload_json IS NULL OR json_valid(payload_json))
  )`,
] as const);

export const kineoV3MigrationChecksum = bytesToHex(
  sha256(utf8ToBytes(kineoV3MigrationStatements.join('\n'))),
);

export const kineoV4MigrationStatements = Object.freeze([
  'ALTER TABLE sync_outbox RENAME TO sync_outbox_v3',
  `CREATE TABLE sync_outbox (
    mutation_id TEXT PRIMARY KEY CHECK (length(mutation_id) > 0),
    account_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    history_epoch INTEGER NOT NULL CHECK (history_epoch >= ${firstRevision}),
    command_kind TEXT NOT NULL CHECK (command_kind IN (
      'acceptLegal', 'saveProfile', 'submitCheckIn', 'applyAttentionTransition',
      'recordPauseToday', 'startRoutine', 'recordRoutineEvent',
      'submitFeedback', 'resetHistory'
    )),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    created_at_ms INTEGER NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= ${unmigratedSchemaVersion}),
    next_attempt_at_ms INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'conflict')),
    last_error_code TEXT,
    FOREIGN KEY(account_id, installation_id)
      REFERENCES local_account_state(account_id, installation_id)
      ON DELETE CASCADE
  )`,
  `INSERT INTO sync_outbox(
    mutation_id, account_id, installation_id, history_epoch, command_kind,
    payload_json, created_at_ms, attempt_count, next_attempt_at_ms, state,
    last_error_code
  )
  SELECT mutation_id, account_id, installation_id, history_epoch, command_kind,
    payload_json, created_at_ms, attempt_count, next_attempt_at_ms, state,
    last_error_code
  FROM sync_outbox_v3`,
  'DROP TABLE sync_outbox_v3',
  `CREATE INDEX sync_outbox_delivery
    ON sync_outbox(state, next_attempt_at_ms, created_at_ms)`,
] as const);

export const kineoV4MigrationChecksum = bytesToHex(
  sha256(utf8ToBytes(kineoV4MigrationStatements.join('\n'))),
);

type KineoMigration = Readonly<{
  version: number;
  name: string;
  checksum: string;
  statements: readonly string[];
}>;

const verifiedHydrationStatements = [
  'ALTER TABLE local_account_state ADD COLUMN hydrated INTEGER NOT NULL DEFAULT 0 CHECK (hydrated IN (0, 1))',
] as const;
export const kineoV5MigrationChecksum = bytesToHex(
  sha256(utf8ToBytes(verifiedHydrationStatements.join('\n'))),
);

const kineoMigrations: readonly KineoMigration[] = Object.freeze([
  {
    version: initialSchemaVersion,
    name: kineoInitialMigrationName,
    checksum: kineoV1MigrationChecksum,
    statements: kineoV1MigrationStatements,
  },
  {
    version: accountSyncSchemaVersion,
    name: kineoV2MigrationName,
    checksum: kineoV2MigrationChecksum,
    statements: kineoV2MigrationStatements,
  },
  {
    version: accountHydrationSchemaVersion,
    name: kineoV3MigrationName,
    checksum: kineoV3MigrationChecksum,
    statements: kineoV3MigrationStatements,
  },
  {
    version: completeSyncOutboxSchemaVersion,
    name: kineoV4MigrationName,
    checksum: kineoV4MigrationChecksum,
    statements: kineoV4MigrationStatements,
  },
  {
    version: verifiedHydrationSchemaVersion,
    name: 'v5_verified_hydration',
    checksum: kineoV5MigrationChecksum,
    statements: verifiedHydrationStatements,
  },
]);

type UserVersionRow = Readonly<{ user_version: number }>;
type TableCountRow = Readonly<{ table_count: number }>;
type MigrationRow = Readonly<{
  version: number;
  name: string;
  checksum: string;
}>;

function integrityFailure(): PersistenceResult<void> {
  return { ok: false, error: { code: 'migrationIntegrityFailure' } };
}

async function userVersion(database: SqliteExecutor): Promise<number> {
  const row = await database.getFirstAsync<UserVersionRow>(
    'PRAGMA user_version',
  );
  return row?.user_version ?? unmigratedSchemaVersion;
}

async function migrationTableExists(database: SqliteExecutor): Promise<boolean> {
  const row = await database.getFirstAsync<TableCountRow>(
    "SELECT count(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  return row?.table_count === initialSchemaVersion;
}

export async function preflightKineoSchema(
  database: SqliteExecutor,
): Promise<PersistenceResult<void>> {
  try {
    const version = await userVersion(database);
    if (version > kineoSchemaVersion) {
      return {
        ok: false,
        error: {
          code: 'futureSchema',
          found: version,
          supported: kineoSchemaVersion,
        },
      };
    }
    const hasMigrationTable = await migrationTableExists(database);
    if (!hasMigrationTable) {
      return version === unmigratedSchemaVersion
        ? { ok: true, value: undefined }
        : integrityFailure();
    }
    const rows = await database.getAllAsync<MigrationRow>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    if (rows.length !== version) {
      return integrityFailure();
    }
    for (const row of rows) {
      const expected = kineoMigrations.find(
        (migration) => migration.version === row.version,
      );
      if (
        expected === undefined ||
        row.name !== expected.name ||
        row.checksum !== expected.checksum
      ) {
        return integrityFailure();
      }
    }
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: { code: 'readFailed' } };
  }
}

export async function migrateKineoDatabase(
  database: SqliteDatabase,
  appliedAtMilliseconds: number,
): Promise<PersistenceResult<void>> {
  if (!Number.isSafeInteger(appliedAtMilliseconds)) {
    return { ok: false, error: { code: 'migrationFailed' } };
  }
  const preflight = await preflightKineoSchema(database);
  if (!preflight.ok) {
    return preflight;
  }
  let version: number;
  try {
    version = await userVersion(database);
  } catch {
    return { ok: false, error: { code: 'readFailed' } };
  }
  try {
    await database.execAsync('PRAGMA foreign_keys = ON');
    for (const migration of kineoMigrations) {
      if (migration.version <= version) continue;
      await database.withExclusiveTransactionAsync(async (transaction) => {
        for (const statement of migration.statements) {
          await transaction.execAsync(statement);
        }
        await transaction.runAsync(
          `INSERT INTO schema_migrations(version, name, checksum, applied_at_ms)
           VALUES (?, ?, ?, ?)`,
          [
            migration.version,
            migration.name,
            migration.checksum,
            appliedAtMilliseconds,
          ],
        );
        await transaction.execAsync(
          `PRAGMA user_version = ${migration.version}`,
        );
      });
      version = migration.version;
    }
  } catch {
    return { ok: false, error: { code: 'migrationFailed' } };
  }

  const verification = await preflightKineoSchema(database);
  if (!verification.ok && verification.error.code === 'readFailed') {
    const error: PersistenceError = { code: 'migrationIntegrityFailure' };
    return { ok: false, error };
  }
  return verification;
}
