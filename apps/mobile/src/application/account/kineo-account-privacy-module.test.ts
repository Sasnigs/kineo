import { describe, expect, it } from '@jest/globals';

import type {
  AccountPrivacyTransport,
  DeletionResumeCredential,
  DeletionResumeStore,
  LocalPrivacyStore,
} from './kineo-account-privacy-module';
import { KineoAccountPrivacyModule } from './kineo-account-privacy-module';
import type { PrivacyResult } from '../../core/account/account-privacy-module';

const nowMilliseconds = 1_788_300_000_000;
const currentGrant = {
  value: 'grant',
  expiresAtMilliseconds: nowMilliseconds + 1,
};
const credential = { jobId: 'job', resumeToken: 'resume' };

class FakeResumeStore implements DeletionResumeStore {
  value?: DeletionResumeCredential;
  async load() { return { ok: true as const, value: this.value }; }
  async save(value: DeletionResumeCredential) {
    this.value = value;
    return { ok: true as const, value: undefined };
  }
  async clear() {
    this.value = undefined;
    return { ok: true as const, value: undefined };
  }
}

class FakeLocalStore implements LocalPrivacyStore {
  resets = 0;
  wipes = 0;
  async resetHistory(_historyEpoch: number): Promise<PrivacyResult<void>> {
    this.resets += 1;
    return { ok: true, value: undefined };
  }
  async wipeAccount(): Promise<PrivacyResult<void>> {
    this.wipes += 1;
    return { ok: true, value: undefined };
  }
}

class FakeTransport implements AccountPrivacyTransport {
  deletionKind: 'pending' | 'complete' = 'complete';
  async resetHistory() {
    return { ok: true as const, value: { historyEpoch: 2 } };
  }
  async requestExport() {
    return {
      ok: true as const,
      value: {
        kind: 'ready' as const,
        jobId: 'job',
        expiresAtMilliseconds: nowMilliseconds + 1,
        downloadToken: 'download',
      },
    };
  }
  async downloadExport() {
    return {
      ok: true as const,
      value: { formatVersion: 'kineo-export-v1' },
    };
  }
  async prepareDeletion() {
    return {
      ok: true as const,
      value: credential,
    };
  }
  async deletionStatus() {
    return {
      ok: true as const,
      value: { kind: this.deletionKind },
    };
  }
}

describe('KineoAccountPrivacyModule', () => {
  it('does not begin irreversible deletion if recovery credentials cannot be saved', async () => {
    const transport = new FakeTransport();
    let destructiveCalls = 0;
    transport.deletionStatus = async () => {
      destructiveCalls += 1;
      return { ok: true, value: { kind: 'complete' } };
    };
    const resume = new FakeResumeStore();
    const failedStore: DeletionResumeStore = {
      load: () => resume.load(), clear: () => resume.clear(),
      save: async () => ({ ok: false, error: { code: 'workflowFailed' } }),
    };
    const module = new KineoAccountPrivacyModule(transport, failedStore, new FakeLocalStore(), () => nowMilliseconds);
    expect((await module.deleteAccount(currentGrant)).ok).toBe(false);
    expect(destructiveCalls).toBe(0);
  });

  it('can resume after the destructive response is lost', async () => {
    const transport: AccountPrivacyTransport = new FakeTransport();
    const resume = new FakeResumeStore();
    const local = new FakeLocalStore();
    transport.deletionStatus = async () => ({ ok: false, error: { code: 'offline' } });
    const module = new KineoAccountPrivacyModule(transport, resume, local, () => nowMilliseconds);
    expect(await module.deleteAccount(currentGrant)).toEqual({ ok: false, error: { code: 'offline' } });
    expect(resume.value).toEqual(credential);
    expect(local.wipes).toBe(0);
    transport.deletionStatus = async () => ({ ok: true, value: { kind: 'complete' } });
    expect(await module.resumeDeletion()).toEqual({ ok: true, value: { kind: 'complete' } });
    expect(local.wipes).toBe(1);
  });

  it('does not report deletion complete without a recovery credential', async () => {
    const local = new FakeLocalStore();
    const module = new KineoAccountPrivacyModule(
      new FakeTransport(), new FakeResumeStore(), local, () => nowMilliseconds,
    );
    await expect(module.resumeDeletion()).resolves.toEqual({
      ok: false, error: { code: 'workflowFailed' },
    });
    expect(local.wipes).toBe(0);
  });

  it('requires a current reauthentication grant for sensitive actions', async () => {
    const module = new KineoAccountPrivacyModule(
      new FakeTransport(),
      new FakeResumeStore(),
      new FakeLocalStore(),
      () => nowMilliseconds,
    );
    await expect(module.requestExport({
      value: 'expired',
      expiresAtMilliseconds: nowMilliseconds,
    })).resolves.toEqual({
      ok: false,
      error: { code: 'reauthenticationRequired' },
    });
  });

  it('resets the local history only after the server succeeds', async () => {
    const local = new FakeLocalStore();
    const module = new KineoAccountPrivacyModule(
      new FakeTransport(),
      new FakeResumeStore(),
      local,
      () => nowMilliseconds,
    );
    await expect(module.resetHistory(currentGrant)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(local.resets).toBe(1);
  });

  it('downloads a prepared one-time export', async () => {
    const module = new KineoAccountPrivacyModule(
      new FakeTransport(),
      new FakeResumeStore(),
      new FakeLocalStore(),
      () => nowMilliseconds,
    );
    const prepared = await module.requestExport(currentGrant);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok || prepared.value.kind !== 'ready') return;

    await expect(module.downloadExport(prepared.value)).resolves.toEqual({
      ok: true,
      value: { formatVersion: 'kineo-export-v1' },
    });
  });

  it('persists deletion recovery before wiping local data', async () => {
    const transport = new FakeTransport();
    transport.deletionKind = 'pending';
    const resume = new FakeResumeStore();
    const local = new FakeLocalStore();
    const module = new KineoAccountPrivacyModule(
      transport,
      resume,
      local,
      () => nowMilliseconds,
    );

    await expect(module.deleteAccount(currentGrant)).resolves.toEqual({
      ok: true,
      value: { kind: 'pending' },
    });
    expect(resume.value).toEqual(credential);
    expect(local.wipes).toBe(0);

    transport.deletionKind = 'complete';
    await expect(module.resumeDeletion()).resolves.toEqual({
      ok: true,
      value: { kind: 'complete' },
    });
    expect(local.wipes).toBe(1);
    expect(resume.value).toBeUndefined();
  });
});
