import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import type { SyncResult } from '../../core/account/sync-module';

const installationIdentifierKey = 'installation-identifier-v1';
const installationIdentifierService = 'com.kineo.installation';
const uuidShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface InstallationSecureStore {
  getItemAsync(
    key: string,
    options: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options: SecureStore.SecureStoreOptions,
  ): Promise<void>;
}

const secureStoreOptions: SecureStore.SecureStoreOptions = Object.freeze({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: installationIdentifierService,
});

export class InstallationIdentity {
  constructor(
    private readonly store: InstallationSecureStore = SecureStore,
    private readonly nextIdentifier: () => string = Crypto.randomUUID,
  ) {}

  async rotateAfterLogout(previousIdentifier: string): Promise<SyncResult<string>> {
    const current = await this.getOrCreate();
    if (!current.ok || current.value !== previousIdentifier) return current;
    try {
      const replacement = this.nextIdentifier();
      if (!uuidShape.test(replacement) || replacement === previousIdentifier) {
        return { ok: false, error: { code: 'localPersistence' } };
      }
      await this.store.setItemAsync(installationIdentifierKey, replacement, secureStoreOptions);
      return { ok: true, value: replacement };
    } catch {
      return { ok: false, error: { code: 'localPersistence' } };
    }
  }

  async getOrCreate(): Promise<SyncResult<string>> {
    try {
      const stored = await this.store.getItemAsync(
        installationIdentifierKey,
        secureStoreOptions,
      );
      if (stored !== null) {
        return uuidShape.test(stored)
          ? { ok: true, value: stored }
          : { ok: false, error: { code: 'localPersistence' } };
      }
      const created = this.nextIdentifier();
      if (!uuidShape.test(created)) {
        return { ok: false, error: { code: 'localPersistence' } };
      }
      await this.store.setItemAsync(
        installationIdentifierKey,
        created,
        secureStoreOptions,
      );
      return { ok: true, value: created };
    } catch {
      return { ok: false, error: { code: 'localPersistence' } };
    }
  }
}
