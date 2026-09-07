import { describe, expect, it } from '@jest/globals';

import {
  SecureRefreshTokenVault,
  refreshTokenKey,
  refreshTokenKeychainService,
  type SecureStorePort,
} from './secure-refresh-token-vault';

const keychainAccessibility = 7;
const credential = {
  refreshToken: 'refresh-token',
  identity: { accountId: '10000000-0000-4000-8000-000000000001', provider: 'email' as const },
};

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
  it('stores refresh and cached identity atomically with non-synchronizing Keychain options', async () => {
    const store = new FakeSecureStore();
    const vault = new SecureRefreshTokenVault(store, keychainAccessibility);

    await expect(vault.save(credential)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(vault.load()).resolves.toEqual({
      ok: true,
      value: credential,
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
    await expect(vault.save(credential)).resolves.toEqual({
      ok: false,
      error: { code: 'secureStorageUnavailable' },
    });
    await expect(vault.clear()).resolves.toEqual({
      ok: false,
      error: { code: 'secureStorageUnavailable' },
    });
  });

  it('preserves the prior credential when an atomic replacement fails', async () => {
    const store = new FakeSecureStore();
    const vault = new SecureRefreshTokenVault(store, keychainAccessibility);
    expect((await vault.save(credential)).ok).toBe(true);
    store.shouldFail = true;
    expect((await vault.save({ ...credential, refreshToken: 'rotated' })).ok).toBe(false);
    store.shouldFail = false;
    await expect(vault.load()).resolves.toEqual({ ok: true, value: credential });
  });

  it('rejects a corrupted credential envelope without replacing it', async () => {
    const store = new FakeSecureStore();
    store.value = '{"refreshToken":"token","identity":{"accountId":"bad"}}';
    const vault = new SecureRefreshTokenVault(store, keychainAccessibility);
    await expect(vault.load()).resolves.toEqual({ ok: false, error: { code: 'secureStorageUnavailable' } });
    expect(store.value).not.toBeNull();
  });
});
