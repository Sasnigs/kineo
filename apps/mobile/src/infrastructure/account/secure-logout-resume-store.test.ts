import { describe, expect, it } from '@jest/globals';
import type { LogoutIntent } from '../../application/account/kineo-logout-workflow';
import type { SecureStorePort } from './secure-refresh-token-vault';
import { SecureLogoutResumeStore } from './secure-logout-resume-store';

const intent: LogoutIntent = {
  installationId: '20000000-0000-4000-8000-000000000001',
  credential: { refreshToken: 'recovery-secret' },
  discardPendingChanges: true,
  localWiped: false,
  phase: 'installationPending',
};

class MemorySecureStore implements SecureStorePort {
  value: string | null = null;
  inaccessible = false;
  async getItemAsync() { if (this.inaccessible) throw new Error('Locked'); return this.value; }
  async setItemAsync(_key: string, value: string) { if (this.inaccessible) throw new Error('Locked'); this.value = value; }
  async deleteItemAsync() { if (this.inaccessible) throw new Error('Locked'); this.value = null; }
}

describe('Secure logout recovery marker', () => {
  it('preserves the private credential and phase across relaunch until explicit clear', async () => {
    const storage = new MemorySecureStore();
    expect(await new SecureLogoutResumeStore(storage).save(intent)).toEqual({ ok: true, value: undefined });
    const reopened = new SecureLogoutResumeStore(storage);
    expect(await reopened.load()).toEqual({ ok: true, value: intent });
    expect(await reopened.clear()).toEqual({ ok: true, value: undefined });
    expect(await reopened.load()).toEqual({ ok: true, value: undefined });
  });

  it.each(['broken', '{}', JSON.stringify({ version: 1, intent: { ...intent, credential: {} } })])(
    'rejects corrupted intent without replacing it, case %#', async (source) => {
      const storage = new MemorySecureStore();
      storage.value = source;
      expect(await new SecureLogoutResumeStore(storage).load())
        .toEqual({ ok: false, error: { code: 'secureStorageUnavailable' } });
      expect(storage.value).toBe(source);
    },
  );

  it('keeps intent on protected-data read, write and clear failures and supports retry', async () => {
    const storage = new MemorySecureStore();
    const marker = new SecureLogoutResumeStore(storage);
    await marker.save(intent);
    storage.inaccessible = true;
    for (const result of [await marker.load(), await marker.save(intent), await marker.clear()]) {
      expect(result).toEqual({ ok: false, error: { code: 'secureStorageUnavailable' } });
    }
    storage.inaccessible = false;
    expect(await marker.load()).toEqual({ ok: true, value: intent });
  });
});
