import type { PersistenceResult } from '../../core/persistence/persistence-contract';
import type { KineoPersistence } from '../../core/persistence/kineo-store';
import type { SyncResult } from '../../core/account/sync-module';
import { KineoSqliteSyncRepository } from '../account/kineo-sqlite-sync-repository';
import { KineoSqliteAccountWriter } from '../account/kineo-sqlite-account-writer';
import { openKineoDatabase } from './expo-sqlite-database';
import { KineoSqliteStore } from './kineo-sqlite-store';
import { deleteProtectedStore, prepareProtectedStorageDirectory, protectDatabaseFiles } from './protected-storage';
import { ProtectedKineoStore } from './protected-kineo-store';

const kineoDatabaseName = 'kineo.sqlite';

export type OpenedKineoLocalRuntime = Readonly<{
  store: KineoPersistence;
  accountWriter(accountId: string, installationId: string): KineoSqliteAccountWriter;
  syncRepository(
    accountId: string,
    installationId: string,
  ): KineoSqliteSyncRepository;
}>;

function syncProtectionResult(
  result: Awaited<ReturnType<typeof protectDatabaseFiles>>,
): SyncResult<void> {
  return result.ok
    ? { ok: true, value: undefined }
    : { ok: false, error: { code: 'localPersistence' } };
}

export async function openProtectedKineoLocalRuntime(
  appliedAtMilliseconds: number,
): Promise<PersistenceResult<OpenedKineoLocalRuntime>> {
  const directory = await prepareProtectedStorageDirectory();
  if (!directory.ok) return directory;
  const opened = await openKineoDatabase({
    databaseName: kineoDatabaseName,
    protectedDirectoryPath: directory.value,
    appliedAtMilliseconds,
  });
  if (!opened.ok) return opened;

  const database = opened.value;
  const initialProtection = await protectDatabaseFiles(database.databasePath);
  if (!initialProtection.ok) {
    try {
      await database.closeAsync();
    } catch {
      // The protection failure is primary and no store escapes this function.
    }
    return initialProtection;
  }
  const store = new ProtectedKineoStore(
    new KineoSqliteStore(database),
    () => protectDatabaseFiles(database.databasePath),
    () => database.closeAsync(),
    () => deleteProtectedStore(() => database.closeAsync()),
  );
  return {
    ok: true,
    value: {
      store,
      accountWriter: (accountId, installationId) => new KineoSqliteAccountWriter(
        database, accountId, installationId,
        () => protectDatabaseFiles(database.databasePath),
      ),
      syncRepository: (accountId, installationId) =>
        new KineoSqliteSyncRepository(
          database,
          accountId,
          installationId,
          async () => syncProtectionResult(
            await protectDatabaseFiles(database.databasePath),
          ),
        ),
    },
  };
}

export async function openProtectedKineoStore(
  appliedAtMilliseconds: number,
): Promise<PersistenceResult<KineoPersistence>> {
  const runtime = await openProtectedKineoLocalRuntime(appliedAtMilliseconds);
  return runtime.ok
    ? { ok: true, value: runtime.value.store }
    : runtime;
}
