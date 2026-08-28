/** @jest-environment node */

import { describe, expect, it } from '@jest/globals';

import {
  kineoSchemaVersion,
  kineoV1MigrationChecksum,
  migrateKineoDatabase,
  preflightKineoSchema,
} from './kineo-schema';
import { NodeSqliteTestDatabase } from './testing/node-sqlite-test-database';

const appliedAtMilliseconds = 1_750_000_000_000;
const expectedUserTableCount = 16;
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
});
