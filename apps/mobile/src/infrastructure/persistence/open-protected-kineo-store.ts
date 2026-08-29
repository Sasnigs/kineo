import type { PersistenceResult } from '../../core/persistence/persistence-contract';
import type { KineoPersistence } from '../../core/persistence/kineo-store';
import { openKineoDatabase } from './expo-sqlite-database';
import { KineoSqliteStore } from './kineo-sqlite-store';
import { deleteProtectedStore, prepareProtectedStorageDirectory, protectDatabaseFiles } from './protected-storage';
import { ProtectedKineoStore } from './protected-kineo-store';

const kineoDatabaseName = 'kineo.sqlite';

export async function openProtectedKineoStore(
  appliedAtMilliseconds: number,
): Promise<PersistenceResult<KineoPersistence>> {
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
  return {
    ok: true,
    value: new ProtectedKineoStore(
      new KineoSqliteStore(database),
      () => protectDatabaseFiles(database.databasePath),
      () => database.closeAsync(),
      () => deleteProtectedStore(() => database.closeAsync()),
    ),
  };
}
