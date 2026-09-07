/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import {
  kineoSchemaVersion,
  kineoV1MigrationChecksum,
  kineoV1MigrationStatements,
  kineoV2MigrationChecksum,
  kineoV2MigrationName,
  kineoV3MigrationChecksum,
  kineoV4MigrationChecksum,
  migrateKineoDatabase,
  preflightKineoSchema,
} from './kineo-schema';
import { NodeSqliteTestDatabase } from './testing/node-sqlite-test-database';

const appliedAtMilliseconds = 1_750_000_000_000;
const expectedUserTableCount = 20;
const futureVersionIncrement = 1;
const changedChecksum = '0'.repeat(kineoV1MigrationChecksum.length);
const injectedFailureStatement = 'CREATE TABLE safety_events';

describe('Kineo SQLite schema', () => {
  it('migrates a fresh real SQLite database and reopens idempotently', async () => {
    const database = new NodeSqliteTestDatabase();

    await expect(
      migrateKineoDatabase(database, appliedAtMilliseconds),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(preflightKineoSchema(database)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      migrateKineoDatabase(database, appliedAtMilliseconds),
    ).resolves.toEqual({ ok: true, value: undefined });

    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const tables = await database.getFirstAsync<{ table_count: number }>(
      "SELECT count(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    expect(version?.user_version).toBe(kineoSchemaVersion);
    expect(tables?.table_count).toBe(expectedUserTableCount);
    await database.closeAsync();
  });

  it('rejects a future schema and an edited migration checksum without erasing either', async () => {
    const future = new NodeSqliteTestDatabase();
    const futureVersion = kineoSchemaVersion + futureVersionIncrement;
    await future.execAsync(`PRAGMA user_version = ${futureVersion}`);
    await expect(preflightKineoSchema(future)).resolves.toEqual({
      ok: false,
      error: {
        code: 'futureSchema',
        found: futureVersion,
        supported: kineoSchemaVersion,
      },
    });

    const edited = new NodeSqliteTestDatabase();
    await migrateKineoDatabase(edited, appliedAtMilliseconds);
    await edited.runAsync(
      'UPDATE schema_migrations SET checksum = ?',
      [changedChecksum],
    );
    await expect(preflightKineoSchema(edited)).resolves.toEqual({
      ok: false,
      error: { code: 'migrationIntegrityFailure' },
    });
    const retainedTables = await edited.getFirstAsync<{ table_count: number }>(
      "SELECT count(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name = 'user_profile'",
    );
    expect(retainedTables?.table_count).toBe(1);
    await future.closeAsync();
    await edited.closeAsync();
  });

  it('rolls back the entire migration when a statement fails', async () => {
    const database = new NodeSqliteTestDatabase(injectedFailureStatement);

    await expect(
      migrateKineoDatabase(database, appliedAtMilliseconds),
    ).resolves.toEqual({ ok: false, error: { code: 'migrationFailed' } });

    const version = await database.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    const tables = await database.getFirstAsync<{ table_count: number }>(
      "SELECT count(*) AS table_count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    expect(version?.user_version).toBe(0);
    expect(tables?.table_count).toBe(0);
    await database.closeAsync();
  });

  it('enforces structural domain constraints in SQLite', async () => {
    const database = new NodeSqliteTestDatabase();
    await migrateKineoDatabase(database, appliedAtMilliseconds);

    await expect(
      database.runAsync(
        `INSERT INTO check_ins(
          id, status, purpose, primary_area, started_at_ms,
          local_day, time_zone_id, calendar_id
        ) VALUES (?, 'draft', 'normal', 'shoulders', ?, ?, ?, ?)`,
        [
          '00000000-0000-0000-0000-000000000001',
          appliedAtMilliseconds,
          '2026-08-27',
          'America/Chicago',
          'gregorian',
        ],
      ),
    ).rejects.toThrow();
    await database.closeAsync();
  });

  it('upgrades an account-free development store without fabricating ownership', async () => {
    const database = new NodeSqliteTestDatabase();
    for (const statement of kineoV1MigrationStatements) {
      await database.execAsync(statement);
    }
    await database.runAsync(
      `INSERT INTO schema_migrations(version, name, checksum, applied_at_ms)
       VALUES (1, 'v1_initial', ?, ?)`,
      [kineoV1MigrationChecksum, appliedAtMilliseconds],
    );
    await database.execAsync('PRAGMA user_version = 1');
    await database.runAsync(
      `INSERT INTO user_profile(
        singleton_id, adult_acknowledged, weekly_goal_days, telemetry_choice,
        created_at_ms, updated_at_ms
      ) VALUES (1, 1, 3, 'notOffered', ?, ?)`,
      [appliedAtMilliseconds, appliedAtMilliseconds],
    );

    await expect(
      migrateKineoDatabase(database, appliedAtMilliseconds),
    ).resolves.toEqual({ ok: true, value: undefined });

    const profile = await database.getFirstAsync<{ profile_count: number }>(
      'SELECT count(*) AS profile_count FROM user_profile',
    );
    const migrations = await database.getAllAsync<{
      version: number;
      checksum: string;
    }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
    expect(profile?.profile_count).toBe(0);
    expect(migrations).toEqual([
      { version: 1, checksum: kineoV1MigrationChecksum },
      { version: 2, checksum: kineoV2MigrationChecksum },
      { version: 3, checksum: kineoV3MigrationChecksum },
      { version: 4, checksum: kineoV4MigrationChecksum },
    ]);
    await database.closeAsync();
  });

  it('constrains the local Account binding and ordered outbox', async () => {
    const database = new NodeSqliteTestDatabase();
    await migrateKineoDatabase(database, appliedAtMilliseconds);

    await database.runAsync(
      `INSERT INTO local_account_state(
        singleton_id, account_id, installation_id, account_status,
        history_epoch, updated_at_ms
      ) VALUES (1, ?, ?, 'active', 1, ?)`,
      [
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        appliedAtMilliseconds,
      ],
    );
    await expect(database.runAsync(
      `INSERT INTO sync_outbox(
        mutation_id, account_id, installation_id, history_epoch, command_kind,
        payload_json, created_at_ms, attempt_count, next_attempt_at_ms, state
      ) VALUES (?, ?, ?, 1, 'resetHistory', '{}', ?, 0, ?, 'pending')`,
      [
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000099',
        '20000000-0000-4000-8000-000000000001',
        appliedAtMilliseconds,
        appliedAtMilliseconds,
      ],
    )).rejects.toThrow();
    expect(kineoV2MigrationName).toBe('v2_account_sync');
    await database.closeAsync();
  });
});
