import { describe, expect, it } from '@jest/globals';

import {
  SecureRefreshTokenVault,
  refreshTokenKey,
  refreshTokenKeychainService,
  type SecureStorePort,
} from './secure-refresh-token-vault';

const keychainAccessibility = 7;

class FakeSecureStore implements SecureStorePort {
  value: string | null = null;
  shouldFail = false;
  lastOptions?: Readonly<{
    keychainAccessible: number;
    keychainService: string;
  }>;

  async getItemAsync(
    _key: string,
    options: Readonly<{ keychainAccessible: number; keychainService: string }>,
  ) {
    this.lastOptions = options;
    if (this.shouldFail) throw new Error('fixture');
    return this.value;
  }

  async setItemAsync(
    _key: string,
    value: string,
    options: Readonly<{ keychainAccessible: number; keychainService: string }>,
  ) {
    this.lastOptions = options;
    if (this.shouldFail) throw new Error('fixture');
    this.value = value;
  }

  async deleteItemAsync(
    _key: string,
    options: Readonly<{ keychainAccessible: number; keychainService: string }>,
  ) {
    this.lastOptions = options;
    if (this.shouldFail) throw new Error('fixture');
    this.value = null;
  }
}

describe('SecureRefreshTokenVault', () => {
  it('stores only the refresh token with non-synchronizing Keychain options', async () => {
    const store = new FakeSecureStore();
    const vault = new SecureRefreshTokenVault(store, keychainAccessibility);

    await expect(vault.save('refresh-token')).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(vault.load()).resolves.toEqual({
      ok: true,
      value: 'refresh-token',
    });
    expect(store.lastOptions).toEqual({
      keychainAccessible: keychainAccessibility,
      keychainService: refreshTokenKeychainService,
    });
    expect(refreshTokenKey).toBe('kineo.refresh-token');
  });

  it('maps storage failures without exposing provider errors', async () => {
    const store = new FakeSecureStore();
    store.shouldFail = true;
    const vault = new SecureRefreshTokenVault(store, keychainAccessibility);

    await expect(vault.load()).resolves.toEqual({
      ok: false,
      error: { code: 'secureStorageUnavailable' },
    });
    await expect(vault.save('refresh-token')).resolves.toEqual({
      ok: false,
      error: { code: 'secureStorageUnavailable' },
    });
    await expect(vault.clear()).resolves.toEqual({
      ok: false,
      error: { code: 'secureStorageUnavailable' },
    });
  });
});
