import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type {
  SqlParameters,
  SqliteDatabase,
  SqliteExecutor,
} from '../../../core/persistence/persistence-contract';

export class NodeSqliteTestDatabase implements SqliteDatabase {
  private readonly database = new DatabaseSync(':memory:');
  private failureSqlFragment?: string;

  constructor(failureSqlFragment?: string) {
    this.failureSqlFragment = failureSqlFragment;
  }

  failNextStatementContaining(fragment: string): void {
    this.failureSqlFragment = fragment;
  }

  private checkFailure(source: string): void {
    if (
      this.failureSqlFragment !== undefined &&
      source.includes(this.failureSqlFragment)
    ) {
      this.failureSqlFragment = undefined;
      throw new Error('Injected SQLite failure.');
    }
  }

  async execAsync(source: string): Promise<void> {
    this.checkFailure(source);
    this.database.exec(source);
  }

  async runAsync(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<void> {
    this.checkFailure(source);
    this.database
      .prepare(source)
      .run(...(parameters as readonly SQLInputValue[]));
  }

  async getFirstAsync<Row>(
    source: string,
    parameters: SqlParameters = [],
  ): Promise<Row | null> {
    this.checkFailure(source);
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
    this.checkFailure(source);
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
