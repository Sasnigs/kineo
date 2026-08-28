import {
  openDatabaseAsync,
  type SQLiteDatabase as ExpoSQLiteDatabase,
} from 'expo-sqlite';

import type {
  PersistenceResult,
  SqlParameters,
  SqliteDatabase,
  SqliteExecutor,
} from '../../core/persistence/persistence-contract';
import { migrateKineoDatabase } from './kineo-schema';

const openOptions = Object.freeze({
  enableChangeListener: false,
  useNewConnection: true,
});

class ExpoSqliteExecutor implements SqliteExecutor {
  constructor(protected readonly database: ExpoSQLiteDatabase) {}

  async execAsync(source: string): Promise<void> {
    await this.database.execAsync(source);
  }

  async runAsync(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<void> {
    await this.database.runAsync(source, [...parameters]);
  }

  async getFirstAsync<Row>(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<Row | null> {
    return this.database.getFirstAsync<Row>(source, [...parameters]);
  }

  async getAllAsync<Row>(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<Row[]> {
    return this.database.getAllAsync<Row>(source, [...parameters]);
  }
}

class KineoExpoSqliteDatabase
  extends ExpoSqliteExecutor
  implements SqliteDatabase
{
  get databasePath(): string {
    return this.database.databasePath;
  }
  async withExclusiveTransactionAsync(
    task: (transaction: SqliteExecutor) => Promise<void>,
  ): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await task(new ExpoSqliteExecutor(transaction));
    });
  }

  async closeAsync(): Promise<void> {
    await this.database.closeAsync();
  }
}

export type OpenKineoDatabaseInput = Readonly<{
  databaseName: string;
  protectedDirectoryPath: string;
  appliedAtMilliseconds: number;
}>;

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export async function openKineoDatabase(
  input: OpenKineoDatabaseInput,
): Promise<PersistenceResult<SqliteDatabase>> {
  if (
    !isNonEmpty(input.databaseName) ||
    !isNonEmpty(input.protectedDirectoryPath) ||
    !Number.isSafeInteger(input.appliedAtMilliseconds)
  ) {
    return { ok: false, error: { code: 'readFailed' } };
  }

  let database: KineoExpoSqliteDatabase;
  try {
    const opened = await openDatabaseAsync(
      input.databaseName,
      openOptions,
      input.protectedDirectoryPath,
    );
    database = new KineoExpoSqliteDatabase(opened);
  } catch {
    return { ok: false, error: { code: 'readFailed' } };
  }

  const migration = await migrateKineoDatabase(
    database,
    input.appliedAtMilliseconds,
  );
  if (!migration.ok) {
    try {
      await database.closeAsync();
    } catch {
      // Preserve the actionable migration error; the unopened store is never returned.
    }
    return migration;
  }
  return { ok: true, value: database };
}
