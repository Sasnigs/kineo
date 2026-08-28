import type { Result } from '../shared/result';

export const persistenceConstraints = [
  'duplicateIdentifier',
  'duplicateRevision',
  'relationship',
  'activeRoutine',
  'immutableRecord',
  'domainInvariant',
] as const;

export type PersistenceConstraint = (typeof persistenceConstraints)[number];

export type PersistenceError =
  | Readonly<{ code: 'protectedDataUnavailable' }>
  | Readonly<{ code: 'futureSchema'; found: number; supported: number }>
  | Readonly<{ code: 'migrationIntegrityFailure' }>
  | Readonly<{ code: 'migrationFailed' }>
  | Readonly<{ code: 'corruptedStore' }>
  | Readonly<{
      code: 'constraintViolation';
      constraint: PersistenceConstraint;
    }>
  | Readonly<{ code: 'recordNotFound' }>
  | Readonly<{ code: 'conflictingWrite' }>
  | Readonly<{ code: 'invalidLifecycleTransition' }>
  | Readonly<{ code: 'readFailed' }>
  | Readonly<{ code: 'writeFailed' }>
  | Readonly<{ code: 'storageProtectionFailed' }>
  | Readonly<{ code: 'deletionFailed' }>
  | Readonly<{ code: 'storeDeleted' }>;

export type PersistenceResult<Value> = Result<Value, PersistenceError>;

export type SqlValue = string | number | null | Uint8Array;
export type SqlParameters = readonly SqlValue[];

export interface SqliteExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, parameters?: SqlParameters): Promise<void>;
  getFirstAsync<Row>(
    source: string,
    parameters?: SqlParameters,
  ): Promise<Row | null>;
  getAllAsync<Row>(
    source: string,
    parameters?: SqlParameters,
  ): Promise<Row[]>;
}

export interface SqliteDatabase extends SqliteExecutor {
  withExclusiveTransactionAsync(
    task: (transaction: SqliteExecutor) => Promise<void>,
  ): Promise<void>;
  closeAsync(): Promise<void>;
}
