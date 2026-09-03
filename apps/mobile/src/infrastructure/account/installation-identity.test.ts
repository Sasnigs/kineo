import { describe, expect, it } from '@jest/globals';

import {
  InstallationIdentity,
  type InstallationSecureStore,
} from './installation-identity';

const installationId = '20000000-0000-4000-8000-000000000001';

class FakeSecureStore implements InstallationSecureStore {
  value: string | null = null;

  async getItemAsync(): Promise<string | null> {
    return this.value;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    this.value = value;
  }
}

describe('InstallationIdentity', () => {
  it('creates and then restores the same device-only identifier', async () => {
    const store = new FakeSecureStore();
    const identity = new InstallationIdentity(store, () => installationId);

    await expect(identity.getOrCreate()).resolves.toEqual({
      ok: true,
      value: installationId,
    });
    await expect(identity.getOrCreate()).resolves.toEqual({
      ok: true,
      value: installationId,
    });
  });

  it('fails closed when the stored identifier is corrupted', async () => {
    const store = new FakeSecureStore();
    store.value = 'not-an-installation-id';
    const identity = new InstallationIdentity(store, () => installationId);

    await expect(identity.getOrCreate()).resolves.toEqual({
      ok: false,
      error: { code: 'localPersistence' },
    });
    expect(store.value).toBe('not-an-installation-id');
  });
});
