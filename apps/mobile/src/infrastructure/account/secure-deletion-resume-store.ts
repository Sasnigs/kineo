import * as SecureStore from 'expo-secure-store';

import type {
  DeletionResumeCredential,
  DeletionResumeStore,
} from '../../application/account/kineo-account-privacy-module';
import type { PrivacyResult } from '../../core/account/account-privacy-module';

const deletionResumeKey = 'deletion-resume-v1';
const deletionResumeService = 'com.kineo.deletion-resume';
const secureStoreOptions: SecureStore.SecureStoreOptions = Object.freeze({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: deletionResumeService,
});

export interface DeletionSecureStore {
  getItemAsync(
    key: string,
    options: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options: SecureStore.SecureStoreOptions,
  ): Promise<void>;
  deleteItemAsync(
    key: string,
    options: SecureStore.SecureStoreOptions,
  ): Promise<void>;
}

export class SecureDeletionResumeStore implements DeletionResumeStore {
  constructor(private readonly store: DeletionSecureStore = SecureStore) {}

  async load(): Promise<
    PrivacyResult<DeletionResumeCredential | undefined>
  > {
    try {
      const stored = await this.store.getItemAsync(
        deletionResumeKey,
        secureStoreOptions,
      );
      if (stored === null) return { ok: true, value: undefined };
      const value: unknown = JSON.parse(stored);
      return isCredential(value)
        ? { ok: true, value }
        : workflowFailure();
    } catch {
      return workflowFailure();
    }
  }

  async save(
    credential: DeletionResumeCredential,
  ): Promise<PrivacyResult<void>> {
    if (!isCredential(credential)) return workflowFailure();
    try {
      await this.store.setItemAsync(
        deletionResumeKey,
        JSON.stringify(credential),
        secureStoreOptions,
      );
      return { ok: true, value: undefined };
    } catch {
      return workflowFailure();
    }
  }

  async clear(): Promise<PrivacyResult<void>> {
    try {
      await this.store.deleteItemAsync(
        deletionResumeKey,
        secureStoreOptions,
      );
      return { ok: true, value: undefined };
    } catch {
      return workflowFailure();
    }
  }
}

function isCredential(value: unknown): value is DeletionResumeCredential {
  return typeof value === 'object' &&
    value !== null &&
    'jobId' in value &&
    typeof value.jobId === 'string' &&
    value.jobId.length > 0 &&
    'resumeToken' in value &&
    typeof value.resumeToken === 'string' &&
    value.resumeToken.length > 0;
}

function workflowFailure<Value>(): PrivacyResult<Value> {
  return { ok: false, error: { code: 'workflowFailed' } };
}
