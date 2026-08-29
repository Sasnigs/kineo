import KineoStorageProtectionModule from '../../../modules/kineo-storage-protection/src/KineoStorageProtectionModule';
import type { ProtectedPathInspection } from '../../../modules/kineo-storage-protection/src/KineoStorageProtection.types';
import type { PersistenceResult } from '../../core/persistence/persistence-contract';

function inspectionIsValid(inspection: ProtectedPathInspection): boolean {
  return (
    inspection.path.trim().length > 0 &&
    inspection.uri.trim().length > 0 &&
    inspection.backupExcluded &&
    (!inspection.completeProtectionSupported ||
      inspection.completeProtectionVerified)
  );
}

async function storageFailure(): Promise<
  PersistenceResult<never>
> {
  try {
    const available =
      await KineoStorageProtectionModule.isProtectedDataAvailableAsync();
    return available
      ? { ok: false, error: { code: 'storageProtectionFailed' } }
      : { ok: false, error: { code: 'protectedDataUnavailable' } };
  } catch {
    return { ok: false, error: { code: 'storageProtectionFailed' } };
  }
}

async function deletionFailure(): Promise<PersistenceResult<never>> {
  try {
    const available = await KineoStorageProtectionModule.isProtectedDataAvailableAsync();
    return available
      ? { ok: false, error: { code: 'deletionFailed' } }
      : { ok: false, error: { code: 'protectedDataUnavailable' } };
  } catch {
    return { ok: false, error: { code: 'deletionFailed' } };
  }
}

export async function prepareProtectedStorageDirectory(): Promise<
  PersistenceResult<string>
> {
  try {
    const inspection =
      await KineoStorageProtectionModule.preparePrivateDirectoryAsync();
    return inspectionIsValid(inspection)
      ? { ok: true, value: inspection.uri }
      : { ok: false, error: { code: 'storageProtectionFailed' } };
  } catch {
    return storageFailure();
  }
}

export async function protectDatabaseFiles(
  databasePath: string,
): Promise<PersistenceResult<void>> {
  if (databasePath.trim().length === 0) {
    return { ok: false, error: { code: 'storageProtectionFailed' } };
  }
  try {
    const inspections =
      await KineoStorageProtectionModule.protectDatabaseFilesAsync(
        databasePath,
      );
    return inspections.length > 0 && inspections.every(inspectionIsValid)
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'storageProtectionFailed' } };
  } catch {
    return storageFailure();
  }
}

export async function deleteProtectedStore(
  closeStore: () => Promise<void>,
): Promise<PersistenceResult<void>> {
  try {
    const marker = await KineoStorageProtectionModule.beginDeletionAsync();
    if (!inspectionIsValid(marker)) {
      return { ok: false, error: { code: 'deletionFailed' } };
    }
    try {
      await closeStore();
    } catch {
      // Keep the marker so the next launch resumes deletion before opening SQLite.
      return { ok: false, error: { code: 'deletionFailed' } };
    }
    const deleted = await KineoStorageProtectionModule.deletePrivateStorageAsync();
    if (!deleted) return { ok: false, error: { code: 'deletionFailed' } };
    const markerRemoved = await KineoStorageProtectionModule.finishDeletionAsync();
    return markerRemoved
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'deletionFailed' } };
  } catch {
    return deletionFailure();
  }
}
