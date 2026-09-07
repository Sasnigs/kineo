import { describe, expect, it } from '@jest/globals';
import type { LogoutCredential, LogoutIntent } from '../../application/account/kineo-logout-workflow';
import type { SupabaseAuthPort } from './supabase-auth-gateway';
import { SupabaseLogoutRecovery } from './supabase-logout-recovery';

const accountId = '10000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;
const intent: LogoutIntent = {
  installationId: '20000000-0000-4000-8000-000000000001',
  credential: { refreshToken: 'logout-only-secret', identity: { accountId, provider: 'email' } },
  discardPendingChanges: true,
  localWiped: true,
  phase: 'installationPending',
};

function fixture(error: { name: string; code?: string } | null = null) {
  const actions: string[] = [];
  let saved: LogoutCredential | undefined;
  const auth = {
    signInWithPassword: async () => ({ data: { session: {
      access_token: 'new-access', refresh_token: 'fresh-sign-in', user: { id: accountId },
    }, user: { id: accountId } }, error: null }),
    signInWithIdToken: async () => ({ data: { session: {
      access_token: 'new-access', refresh_token: 'fresh-social-sign-in', user: { id: accountId },
    }, user: { id: accountId } }, error: null }),
    refreshSession: async ({ refresh_token }: { refresh_token: string }) => {
      expect(refresh_token).toBe('logout-only-secret');
      actions.push('refresh');
      const session = { access_token: 'recovery-access', refresh_token: 'rotated-recovery', user: { id: accountId } };
      return { data: { session: error === null ? session : null, user: session.user }, error };
    },
    signOut: async (options: { scope: string }) => {
      expect(options.scope).toBe('local');
      actions.push('authLogout');
      return { error: null };
    },
  } as unknown as SupabaseAuthPort;
  const transport = new SupabaseLogoutRecovery(() => auth, {
    invoke: async (name, options) => {
      expect(saved?.refreshToken).toBe('rotated-recovery');
      expect(name).toBe('revoke-installation');
      expect(options).toEqual({ body: { installationId: intent.installationId }, headers: { Authorization: 'Bearer recovery-access' } });
      actions.push('revoke');
      return { data: { status: 'revoked' }, error: null };
    },
  }, () => nowMilliseconds);
  const saveCredential = async (credential: LogoutCredential) => {
    saved = credential; actions.push('saveRecovery'); return { ok: true as const, value: undefined };
  };
  return { actions, auth, transport, saveCredential };
}

describe('Isolated logout remote recovery', () => {
  it('returns same-account email credentials solely for the recovery marker', async () => {
    const { transport, actions } = fixture();
    expect(await transport.reauthenticate(intent, { kind: 'email', credentials: {
      email: 'person@example.com', password: 'correct horse battery staple',
    } })).toEqual({ ok: true, value: {
      refreshToken: 'fresh-sign-in', identity: { accountId, provider: 'email' },
    } });
    expect(actions).toEqual([]);
  });

  it.each(['apple', 'google'] as const)('accepts isolated %s credentials only for the expected account', async (provider) => {
    const { transport } = fixture();
    expect(await transport.reauthenticate(intent, { kind: 'identityToken', provider, token: 'native-token' }))
      .toEqual({ ok: true, value: {
        refreshToken: 'fresh-social-sign-in', identity: { accountId, provider },
      } });
  });

  it('ends a mismatched isolated session and never returns its credential to the marker', async () => {
    const { transport, actions, auth } = fixture();
    auth.signInWithPassword = async () => ({ data: { session: {
      access_token: 'wrong-access', refresh_token: 'wrong-refresh',
      user: { id: '10000000-0000-4000-8000-000000000002' },
    }, user: null }, error: null });
    expect(await transport.reauthenticate(intent, { kind: 'email', credentials: {
      email: 'other@example.com', password: 'correct horse battery staple',
    } })).toEqual({ ok: false, error: { code: 'reauthenticationRequired' } });
    expect(actions).toEqual(['authLogout']);
  });

  it('persists rotated recovery credentials before revoking the installation', async () => {
    const { transport, actions, saveCredential } = fixture();
    expect(await transport.revokeInstallation(intent, saveCredential)).toEqual({ ok: true, value: undefined });
    expect(actions).toEqual(['refresh', 'saveRecovery', 'revoke']);
  });

  it('logs out only the recovered Auth session', async () => {
    const { transport, actions, saveCredential } = fixture();
    expect(await transport.logoutSession({ ...intent, phase: 'authPending' }, saveCredential))
      .toEqual({ ok: true, value: undefined });
    expect(actions).toEqual(['refresh', 'saveRecovery', 'authLogout']);
  });

  it('does not treat an offline cached identity as successful remote logout', async () => {
    const { transport, actions, saveCredential } = fixture({ name: 'AuthRetryableFetchError' });
    expect(await transport.logoutSession({ ...intent, phase: 'authPending' }, saveCredential))
      .toEqual({ ok: false, error: { code: 'offline' } });
    expect(actions).toEqual(['refresh']);
  });

  it('recovers a crash after Auth revocation without clearing the durable marker', async () => {
    const { transport, actions, saveCredential } = fixture({ name: 'AuthApiError', code: 'refresh_token_not_found' });
    expect(await transport.logoutSession({ ...intent, phase: 'authPending' }, saveCredential))
      .toEqual({ ok: true, value: undefined });
    expect(actions).toEqual(['refresh']);
    expect(await transport.revokeInstallation(intent, saveCredential))
      .toEqual({ ok: false, error: { code: 'sessionExpired' } });
  });

  it('never revokes remotely when rotated credential storage fails', async () => {
    const { transport, actions } = fixture();
    expect(await transport.revokeInstallation(intent,
      async () => ({ ok: false, error: { code: 'secureStorageUnavailable' } })))
      .toEqual({ ok: false, error: { code: 'secureStorageUnavailable' } });
    expect(actions).toEqual(['refresh']);
  });
});
