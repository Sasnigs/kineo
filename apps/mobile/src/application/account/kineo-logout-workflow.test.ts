import { describe, expect, it, jest } from '@jest/globals';
import type { AuthResult } from '../../core/account/auth-module';
import { KineoLogoutWorkflow, type LogoutIntent, type LogoutOperations, type LogoutResumeStore } from './kineo-logout-workflow';

const installationId = '20000000-0000-4000-8000-000000000001';
const credential = { refreshToken: 'private-refresh-token' };
const accountIdentity = { accountId: '10000000-0000-4000-8000-000000000001', provider: 'email' as const };

class MemoryMarker implements LogoutResumeStore {
  value?: LogoutIntent;
  async load(): Promise<AuthResult<LogoutIntent | undefined>> { return { ok: true, value: this.value }; }
  async save(value: LogoutIntent): Promise<AuthResult<void>> { this.value = value; return { ok: true, value: undefined }; }
  async clear(): Promise<AuthResult<void>> { this.value = undefined; return { ok: true, value: undefined }; }
}

function fixture() {
  const marker = new MemoryMarker();
  const actions: string[] = [];
  const succeed = async (action: string): Promise<AuthResult<void>> => {
    actions.push(action); return { ok: true, value: undefined };
  };
  const operations: LogoutOperations = {
    flushPendingMutations: () => succeed('flush'),
    capture: async () => ({ ok: true, value: { installationId, credential } }),
    revokeInstallation: () => succeed('revoke'),
    logoutSession: () => succeed('authLogout'),
    wipeLocalAccount: () => succeed('wipe'),
    rotateInstallation: () => succeed('rotate'),
  };
  return { marker, actions, operations, workflow: new KineoLogoutWorkflow(marker, operations) };
}

describe('Durable logout workflow', () => {
  it('refuses a different account without replacing intent or revoking any installation', async () => {
    const { marker, operations, actions } = fixture();
    const original: LogoutIntent = { installationId, credential: { ...credential, identity: accountIdentity },
      discardPendingChanges: true, localWiped: true, phase: 'installationPending' };
    marker.value = original;
    expect(await new KineoLogoutWorkflow(marker, operations).reauthenticatePendingLogout(async () => ({
      ok: true, value: { refreshToken: 'wrong-account', identity: {
        accountId: '10000000-0000-4000-8000-000000000002', provider: 'email',
      } },
    }))).toEqual({ ok: false, error: { code: 'reauthenticationRequired' } });
    expect(marker.value).toEqual(original);
    expect(actions).toEqual([]);
  });

  it('does not attempt new authentication for a legacy marker without verified identity', async () => {
    const { marker, operations } = fixture();
    marker.value = { installationId, credential, discardPendingChanges: true, localWiped: true, phase: 'installationPending' };
    const authenticate = jest.fn<(intent: LogoutIntent) => Promise<AuthResult<typeof credential>>>();
    expect(await new KineoLogoutWorkflow(marker, operations).reauthenticatePendingLogout(authenticate))
      .toEqual({ ok: false, error: { code: 'reauthenticationRequired' } });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('retains fresh verified credentials if network cleanup fails after reauthentication', async () => {
    const { marker, operations } = fixture();
    marker.value = { installationId, credential: { ...credential, identity: accountIdentity },
      discardPendingChanges: true, localWiped: true, phase: 'installationPending' };
    operations.revokeInstallation = async () => ({ ok: false, error: { code: 'offline' } });
    expect(await new KineoLogoutWorkflow(marker, operations).reauthenticatePendingLogout(async () => ({
      ok: true, value: { refreshToken: 'fresh-verified', identity: accountIdentity },
    }))).toMatchObject({ ok: true, value: { kind: 'pending', error: { code: 'offline' } } });
    expect(marker.value.credential.refreshToken).toBe('fresh-verified');
    expect(marker.value.installationId).toBe(installationId);
  });

  it('uses explicitly reauthenticated same-account credentials only to complete pending logout', async () => {
    const { marker, operations, actions } = fixture();
    marker.value = { installationId, credential: { ...credential, identity: accountIdentity },
      discardPendingChanges: true, localWiped: true, phase: 'installationPending' };
    operations.revokeInstallation = async (intent) => {
      expect(intent.installationId).toBe(installationId);
      expect(intent.credential.refreshToken).toBe('freshly-verified');
      actions.push('revoke');
      return { ok: true, value: undefined };
    };
    const recovered = await new KineoLogoutWorkflow(marker, operations).reauthenticatePendingLogout(
      async () => ({ ok: true, value: { refreshToken: 'freshly-verified', identity: accountIdentity } }),
    );
    expect(recovered).toEqual({ ok: true, value: { kind: 'complete' } });
    expect(actions).toEqual(['revoke', 'authLogout', 'rotate']);
    expect(marker.value).toBeUndefined();
  });

  it('does not lose a logout request behind an earlier empty recovery check', async () => {
    const { workflow, actions } = fixture();
    const checking = workflow.resumePendingLogout();
    const loggingOut = workflow.logout('waitForSync');
    await checking;
    expect(await loggingOut).toEqual({ ok: true, value: undefined });
    expect(actions).toEqual(['flush', 'revoke', 'authLogout', 'wipe', 'rotate']);
  });

  it('coalesces startup recovery with an in-flight logout', async () => {
    const { workflow, actions } = fixture();
    const [loggedOut, recovered] = await Promise.all([
      workflow.logout('waitForSync'), workflow.resumePendingLogout(),
    ]);
    expect(loggedOut).toEqual({ ok: true, value: undefined });
    expect(recovered).toEqual({ ok: true, value: { kind: 'complete' } });
    expect(actions).toEqual(['flush', 'revoke', 'authLogout', 'wipe', 'rotate']);
  });

  it('keeps the preceding phase after a crash immediately after remote installation revocation', async () => {
    const { workflow, marker, actions, operations } = fixture();
    const save = marker.save.bind(marker);
    jest.spyOn(marker, 'save').mockImplementation((intent) => intent.phase === 'authPending'
      ? Promise.resolve({ ok: false, error: { code: 'secureStorageUnavailable' } }) : save(intent));
    expect((await workflow.logout('waitForSync')).ok).toBe(false);
    expect(marker.value?.phase).toBe('installationPending');
    expect(actions).toEqual(['flush', 'revoke']);
    jest.restoreAllMocks();
    expect(await new KineoLogoutWorkflow(marker, operations).resumePendingLogout())
      .toEqual({ ok: true, value: { kind: 'complete' } });
  });

  it('keeps pending changes and the ordinary session intact when synchronization fails', async () => {
    const { workflow, marker, actions, operations } = fixture();
    operations.flushPendingMutations = async () => ({ ok: false, error: { code: 'offline' } });
    expect(await workflow.logout('waitForSync')).toEqual({ ok: false, error: { code: 'offline' } });
    expect(marker.value).toBeUndefined();
    expect(actions).toEqual([]);
  });

  it.each<keyof Pick<LogoutOperations, 'revokeInstallation' | 'logoutSession' | 'wipeLocalAccount' | 'rotateInstallation'>>([
    'revokeInstallation', 'logoutSession', 'wipeLocalAccount', 'rotateInstallation',
  ])('retains intent on %s failure and safely completes after relaunch', async (operation) => {
    const { workflow, marker, operations } = fixture();
    const original = operations[operation];
    const failing = jest.spyOn(operations, operation).mockResolvedValue({ ok: false, error: { code: 'unexpected' } });
    expect((await workflow.logout('waitForSync')).ok).toBe(false);
    expect(marker.value).toBeDefined();
    failing.mockRestore();
    expect(operations[operation]).toBe(original);
    expect(await new KineoLogoutWorkflow(marker, operations).resumePendingLogout())
      .toEqual({ ok: true, value: { kind: 'complete' } });
    expect(marker.value).toBeUndefined();
  });

  it('does not revoke or wipe when protected intent storage is unavailable', async () => {
    const { workflow, marker, actions } = fixture();
    jest.spyOn(marker, 'save').mockResolvedValue({ ok: false, error: { code: 'secureStorageUnavailable' } });
    expect(await workflow.logout('discardPendingChanges')).toEqual({ ok: false, error: { code: 'secureStorageUnavailable' } });
    expect(actions).toEqual([]);
  });

  it('retries a lost phase write without repeating a completed local wipe', async () => {
    const { workflow, marker, operations, actions } = fixture();
    const clear = jest.spyOn(marker, 'clear').mockResolvedValue({ ok: false, error: { code: 'secureStorageUnavailable' } });
    expect((await workflow.logout('waitForSync')).ok).toBe(false);
    expect(marker.value).toMatchObject({ phase: 'localPending', localWiped: true });
    clear.mockRestore();
    actions.length = 0;
    expect(await new KineoLogoutWorkflow(marker, operations).resumePendingLogout())
      .toEqual({ ok: true, value: { kind: 'complete' } });
    expect(actions).toEqual(['rotate']);
  });

  it('wipes explicit offline discard before remote calls and resumes with the isolated credential', async () => {
    const { workflow, marker, actions, operations } = fixture();
    operations.revokeInstallation = async () => {
      actions.push('offline'); return { ok: false, error: { code: 'offline' } };
    };
    expect(await workflow.logout('discardPendingChanges')).toEqual({ ok: false, error: { code: 'offline' } });
    expect(actions).toEqual(['wipe', 'offline']);
    expect(marker.value).toMatchObject({ localWiped: true, phase: 'installationPending', credential });
    operations.revokeInstallation = async (intent, saveCredential) => {
      expect(intent.credential).toEqual(credential);
      return saveCredential({ refreshToken: 'rotated-recovery-token' });
    };
    operations.logoutSession = async (intent) => {
      expect(intent.credential.refreshToken).toBe('rotated-recovery-token');
      return { ok: true, value: undefined };
    };
    expect(await new KineoLogoutWorkflow(marker, operations).resumePendingLogout())
      .toEqual({ ok: true, value: { kind: 'complete' } });
    expect(marker.value).toBeUndefined();
  });

  it('flushes, revokes, ends auth, wipes and rotates before clearing recoverable intent', async () => {
    const { workflow, marker, actions, operations } = fixture();
    operations.revokeInstallation = async () => {
      expect(marker.value).toMatchObject({ phase: 'installationPending', credential });
      actions.push('revoke');
      return { ok: true, value: undefined };
    };
    expect(await workflow.logout('waitForSync')).toEqual({ ok: true, value: undefined });
    expect(actions).toEqual(['flush', 'revoke', 'authLogout', 'wipe', 'rotate']);
    expect(marker.value).toBeUndefined();
  });
});
