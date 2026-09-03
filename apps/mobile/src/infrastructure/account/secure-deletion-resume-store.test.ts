import { describe, expect, it } from '@jest/globals';

import {
  SecureDeletionResumeStore,
  type DeletionSecureStore,
} from './secure-deletion-resume-store';

class FakeSecureStore implements DeletionSecureStore {
  value: string | null = null;
  async getItemAsync() { return this.value; }
  async setItemAsync(_key: string, value: string) { this.value = value; }
  async deleteItemAsync() { this.value = null; }
}

describe('SecureDeletionResumeStore', () => {
  it('persists and clears only the opaque resume credential', async () => {
    const secure = new FakeSecureStore();
    const store = new SecureDeletionResumeStore(secure);
    const credential = { jobId: 'job', resumeToken: 'token' };
    await expect(store.save(credential)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: credential,
    });
    await store.clear();
    await expect(store.load()).resolves.toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('fails closed on corrupted protected state', async () => {
    const secure = new FakeSecureStore();
    secure.value = '{bad-json';
    const store = new SecureDeletionResumeStore(secure);
    await expect(store.load()).resolves.toEqual({
      ok: false,
      error: { code: 'workflowFailed' },
    });
  });
});
