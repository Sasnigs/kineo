import { NativeModule, requireNativeModule } from 'expo';
import type { ProtectedPathInspection } from './KineoStorageProtection.types';

declare class KineoStorageProtectionModule extends NativeModule<{}> {
  isProtectedDataAvailableAsync(): Promise<boolean>;
  preparePrivateDirectoryAsync(): Promise<ProtectedPathInspection>;
  protectDatabaseFilesAsync(
    databasePath: string,
  ): Promise<readonly ProtectedPathInspection[]>;
  beginDeletionAsync(): Promise<ProtectedPathInspection>;
  deletePrivateStorageAsync(): Promise<boolean>;
  finishDeletionAsync(): Promise<boolean>;
}

export default requireNativeModule<KineoStorageProtectionModule>('KineoStorageProtection');
