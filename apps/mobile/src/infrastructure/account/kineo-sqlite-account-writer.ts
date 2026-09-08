import type { PendingMutation } from '../../core/account/sync-contract';
import type { KineoStore } from '../../core/persistence/kineo-store';
import type {
  PersistenceError, PersistenceResult, SqliteDatabase, SqliteExecutor,
} from '../../core/persistence/persistence-contract';
import { KineoSqliteStore } from '../persistence/kineo-sqlite-store';
import { KineoSqliteSyncRepository } from './kineo-sqlite-sync-repository';

export type LocalAccountWrite = (store: KineoStore) => Promise<PersistenceResult<void>>;

export interface AccountLocalWriter {
  commit(mutation: PendingMutation, write: LocalAccountWrite): Promise<PersistenceResult<void>>;
}

class AccountWriteAbort extends Error {
  constructor(readonly failure: PersistenceError) { super(failure.code); }
}

/** Owns the single commit point for offline product changes and their outbox intent. */
export class KineoSqliteAccountWriter implements AccountLocalWriter {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly accountId: string,
    private readonly installationId: string,
    private readonly verifyProtection: () => Promise<PersistenceResult<void>>,
  ) {}

  async commit(mutation: PendingMutation, write: LocalAccountWrite): Promise<PersistenceResult<void>> {
    try {
      const protectedBefore = await this.verifyProtection();
      if (!protectedBefore.ok) return protectedBefore;
      await this.database.withExclusiveTransactionAsync(async (executor) => {
        const transaction = joinedTransaction(executor, this.database.databasePath);
        const outbox = new KineoSqliteSyncRepository(transaction, this.accountId, this.installationId);
        const account = await outbox.loadAccount();
        if (!account.ok) throw new AccountWriteAbort({ code: 'readFailed' });
        if (account.value === undefined || account.value.status !== 'active' ||
            mutation.accountId !== this.accountId || mutation.installationId !== this.installationId ||
            mutation.historyEpoch !== account.value.historyEpoch) {
          throw new AccountWriteAbort({ code: 'conflictingWrite' });
        }
        const written = await write(new KineoSqliteStore(transaction));
        if (!written.ok) throw new AccountWriteAbort(written.error);
        const enqueued = await outbox.enqueue(mutation);
        if (!enqueued.ok) throw new AccountWriteAbort({ code: 'writeFailed' });
        const protectedAfter = await this.verifyProtection();
        if (!protectedAfter.ok) throw new AccountWriteAbort(protectedAfter.error);
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof AccountWriteAbort
        ? error.failure : { code: 'writeFailed' } };
    }
  }
}

// Repository transactions join the already-exclusive outer transaction. Only
// this writer commits/rolls back; a repository's typed failure aborts the whole write.
function joinedTransaction(executor: SqliteExecutor, databasePath: string): SqliteDatabase {
  return {
    databasePath,
    execAsync: (sql) => executor.execAsync(sql),
    runAsync: (sql, parameters) => executor.runAsync(sql, parameters),
    getFirstAsync: (sql, parameters) => executor.getFirstAsync(sql, parameters),
    getAllAsync: (sql, parameters) => executor.getAllAsync(sql, parameters),
    withExclusiveTransactionAsync: (operation) => operation(executor),
    closeAsync: async () => { throw new AccountWriteAbort({ code: 'invalidLifecycleTransition' }); },
  };
}
