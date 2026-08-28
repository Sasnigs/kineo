/** @jest-environment node */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from '@jest/globals';

import type {
  SqlParameters,
  SqliteDatabase,
  SqliteExecutor,
} from '../../core/persistence/persistence-contract';
import {
  kineoSchemaVersion,
  kineoV1MigrationChecksum,
  migrateKineoDatabase,
  preflightKineoSchema,
} from './kineo-schema';

const appliedAtMilliseconds = 1_750_000_000_000;
const expectedUserTableCount = 16;
const futureVersionIncrement = 1;
const changedChecksum = '0'.repeat(kineoV1MigrationChecksum.length);
const injectedFailureStatement = 'CREATE TABLE safety_events';

class NodeSqliteDatabase implements SqliteDatabase {
  private readonly database = new DatabaseSync(':memory:');

  constructor(private readonly failWhenSqlIncludes?: string) {}

  async execAsync(source: string): Promise<void> {
    if (this.failWhenSqlIncludes !== undefined && source.includes(this.failWhenSqlIncludes)) {
      throw new Error('Injected SQLite failure.');
    }
    this.database.exec(source);
  }

  async runAsync(source: string, parameters: SqlParameters = []): Promise<void> {
    this.database
      .prepare(source)
      .run(...(parameters as readonly SQLInputValue[]));
  }

  async getFirstAsync<Row>(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<Row | null> {
    return (
      (this.database
        .prepare(source)
        .get(...(parameters as readonly SQLInputValue[])) as Row | undefined) ??
      null
    );
  }

  async getAllAsync<Row>(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<Row[]> {
    return this.database
      .prepare(source)
      .all(...(parameters as readonly SQLInputValue[])) as Row[];
  }

  async withExclusiveTransactionAsync(
    task: (transaction: SqliteExecutor) => Promise<void>,
  ): Promise<void> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      await task(this);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    this.database.close();
  }
}

describe('Kineo SQLite schema', () => {
  it('migrates a fresh real SQLite database and reopens idempotently', async () => {
    const database = new NodeSqliteDatabase();

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
    const future = new NodeSqliteDatabase();
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

    const edited = new NodeSqliteDatabase();
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
    const database = new NodeSqliteDatabase(injectedFailureStatement);

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
    const database = new NodeSqliteDatabase();
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
