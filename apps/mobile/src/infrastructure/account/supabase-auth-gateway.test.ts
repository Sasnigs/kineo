import { describe, expect, it } from '@jest/globals';

import type { AuthResult } from '../../core/account/auth-module';
import {
  SupabaseAuthGateway,
  reauthenticationGrantLifetimeMilliseconds,
  type SupabaseAuthPort,
  type SupabaseSession,
} from './supabase-auth-gateway';
import type { RefreshTokenVault, StoredRefreshCredential } from './secure-refresh-token-vault';

const accountId = '10000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;

class FakeVault implements RefreshTokenVault {
  token?: string;
  identity?: StoredRefreshCredential['identity'];
  savedValues: string[] = [];

  async load(): Promise<AuthResult<StoredRefreshCredential | undefined>> {
    return { ok: true, value: this.token === undefined ? undefined : {
      refreshToken: this.token, identity: this.identity,
    } };
  }

  async save(credential: StoredRefreshCredential): Promise<AuthResult<void>> {
    this.token = credential.refreshToken;
    this.identity = credential.identity;
    this.savedValues.push(credential.refreshToken);
    return { ok: true, value: undefined };
  }

  async clear(): Promise<AuthResult<void>> {
    this.token = undefined;
    this.identity = undefined;
    return { ok: true, value: undefined };
  }
}

const session: SupabaseSession = {
  access_token: 'access-secret',
  refresh_token: 'rotated-refresh',
  user: {
    id: accountId,
    email: 'person@example.com',
    app_metadata: { provider: 'email' },
  },
};

class FakeAuth implements SupabaseAuthPort {
  refreshCount = 0;
  response: Awaited<ReturnType<SupabaseAuthPort['refreshSession']>> = {
    data: { session, user: session.user },
    error: null,
  };
  passwordCredentials?: Readonly<{ email: string; password: string }>;
  updatedPassword?: string;
  adoptedSessionCount = 0;
  logoutScope?: string;

  async refreshSession() {
    this.refreshCount += 1;
    return this.response;
  }

  async signInWithIdToken() {
    return this.response;
  }

  async signUp() {
    return this.response;
  }

  async signInWithPassword(credentials: Readonly<{ email: string; password: string }>) {
    this.passwordCredentials = credentials;
    return this.response;
  }

  async resend() {
    return { data: { session: null, user: null }, error: null };
  }

  async resetPasswordForEmail() {
    return { data: {}, error: null };
  }

  async setSession() {
    this.adoptedSessionCount += 1;
    return this.response;
  }

  async exchangeCodeForSession() {
    return this.response;
  }

  async updateUser(input: Readonly<{ password: string }>) {
    this.updatedPassword = input.password;
    return { data: { user: session.user }, error: null };
  }

  async getUser() {
    return { data: { user: session.user }, error: null };
  }

  async signOut(input?: Readonly<{ scope: 'local' }>) {
    this.logoutScope = input?.scope;
    return { error: null };
  }
}

describe('SupabaseAuthGateway', () => {
  it('rejects a late login callback from before logout even after a fresh login is allowed', async () => {
    const auth = new FakeAuth();
    let finishSignIn: ((response: typeof auth.response) => void) | undefined;
    auth.signInWithPassword = () => new Promise((resolve) => { finishSignIn = resolve; });
    const vault = new FakeVault();
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    const signingIn = gateway.signInWithEmail({ email: 'person@example.com', password: 'correct horse battery staple' });
    await gateway.suspendForLogout();
    gateway.resumeAfterLogout();
    if (finishSignIn === undefined) throw new Error('Sign-in did not start.');
    finishSignIn(auth.response);
    expect(await signingIn).toEqual({ ok: false, error: { code: 'sessionExpired' } });
    expect(vault.token).toBeUndefined();
  });

  it('drains rotation before logout capture, blocks refresh while suspended, then permits a new login', async () => {
    const auth = new FakeAuth();
    const vault = new FakeVault();
    vault.token = 'original-refresh';
    let finishRefresh: ((response: typeof auth.response) => void) | undefined;
    auth.refreshSession = () => new Promise((resolve) => { finishRefresh = resolve; });
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    const restoring = gateway.restoreSession();
    await Promise.resolve();
    const suspending = gateway.suspendForLogout();
    if (finishRefresh === undefined) throw new Error('Refresh did not start.');
    finishRefresh(auth.response);
    await restoring;
    await suspending;
    expect(vault.token).toBe('rotated-refresh');
    expect(await gateway.validAccessToken()).toEqual({ ok: false, error: { code: 'sessionExpired' } });
    await vault.clear();
    gateway.resumeAfterLogout();
    expect(await gateway.signInWithEmail({ email: 'person@example.com', password: 'correct horse battery staple' }))
      .toMatchObject({ ok: true, value: { kind: 'authenticated' } });
  });

  it('restores only cached identity when refresh is offline', async () => {
    const auth = new FakeAuth();
    auth.response = { data: { session: null, user: null }, error: { name: 'AuthRetryableFetchError' } };
    const vault = new FakeVault();
    vault.token = 'stored-refresh';
    vault.identity = { accountId, provider: 'email' };
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    await expect(gateway.restoreSession()).resolves.toEqual({
      ok: true, value: { kind: 'cached', accountId, provider: 'email' },
    });
    await expect(gateway.validAccessToken()).resolves.toEqual({ ok: false, error: { code: 'offline' } });
    expect(vault.token).toBe('stored-refresh');
  });

  it('does not invent cached identity for a legacy refresh token', async () => {
    const auth = new FakeAuth();
    auth.response = { data: { session: null, user: null }, error: { name: 'AuthRetryableFetchError' } };
    const vault = new FakeVault();
    vault.token = 'legacy-refresh';
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    await expect(gateway.restoreSession()).resolves.toEqual({ ok: false, error: { code: 'offline' } });
  });

  it('serializes refresh for concurrent authenticated requests', async () => {
    const auth = new FakeAuth();
    const vault = new FakeVault();
    vault.token = 'stored-refresh';
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    const tokens = await Promise.all([gateway.validAccessToken(), gateway.validAccessToken()]);
    expect(tokens).toEqual([
      { ok: true, value: session.access_token }, { ok: true, value: session.access_token },
    ]);
    expect(auth.refreshCount).toBe(1);
  });

  it('does not switch the product session when social reauthentication selects another account', async () => {
    const auth = new FakeAuth();
    const isolated = new FakeAuth();
    isolated.response = {
      data: {
        session: { ...session, user: { ...session.user, id: 'another-account' } },
        user: { ...session.user, id: 'another-account' },
      },
      error: null,
    };
    const vault = new FakeVault();
    vault.token = 'original-refresh';
    const gateway = new SupabaseAuthGateway(
      auth, vault, () => 'grant-id', () => nowMilliseconds,
      undefined, undefined, () => isolated,
    );

    await expect(gateway.signInWithIdentityToken('google', 'identity', undefined, 'reauthenticate'))
      .resolves.toEqual({ ok: false, error: { code: 'reauthenticationRequired' } });
    expect(auth.adoptedSessionCount).toBe(0);
    expect(vault.token).toBe('original-refresh');
  });

  it('adopts a matching reauthenticated session only after checking account identity', async () => {
    const auth = new FakeAuth();
    const gateway = new SupabaseAuthGateway(
      auth, new FakeVault(), () => 'grant-id', () => nowMilliseconds,
      undefined, undefined, () => new FakeAuth(),
    );
    expect((await gateway.signInWithIdentityToken('apple', 'identity', undefined, 'reauthenticate')).ok)
      .toBe(true);
    expect(auth.adoptedSessionCount).toBe(1);
  });

  it('logs out only the current authentication session', async () => {
    const auth = new FakeAuth();
    const vault = new FakeVault();
    vault.token = 'refresh';
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    expect((await gateway.logout()).ok).toBe(true);
    expect(auth.logoutScope).toBe('local');
    expect(vault.token).toBeUndefined();
  });

  it('waits for an in-flight refresh before clearing credentials on logout', async () => {
    const auth = new FakeAuth();
    let releaseRefresh: (value: typeof auth.response) => void = () => undefined;
    auth.refreshSession = () => new Promise((resolve) => { releaseRefresh = resolve; });
    const vault = new FakeVault();
    vault.token = 'refresh';
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    const refreshing = gateway.restoreSession();
    await Promise.resolve();
    const logout = gateway.logout();
    releaseRefresh(auth.response);
    await refreshing;
    expect((await logout).ok).toBe(true);
    expect(vault.token).toBeUndefined();
    expect(await gateway.validAccessToken()).toEqual({ ok: false, error: { code: 'sessionExpired' } });
  });

  it('does not fall back to cached identity when the server revokes refresh access', async () => {
    const auth = new FakeAuth();
    auth.response = { data: { session: null, user: null }, error: { name: 'AuthApiError', code: 'refresh_token_not_found' } };
    const vault = new FakeVault();
    vault.token = 'revoked';
    vault.identity = { accountId, provider: 'email' };
    const gateway = new SupabaseAuthGateway(auth, vault, () => 'grant-id', () => nowMilliseconds);
    expect(await gateway.restoreSession()).toEqual({ ok: true, value: { kind: 'signedOut' } });
    expect(vault.token).toBeUndefined();
  });

  it('restores by rotating only the refresh token from SecureStore', async () => {
    const auth = new FakeAuth();
    const vault = new FakeVault();
    vault.token = 'stored-refresh';
    const gateway = new SupabaseAuthGateway(
      auth,
      vault,
      () => 'grant-id',
      () => nowMilliseconds,
    );

    await expect(gateway.restoreSession()).resolves.toEqual({
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    });
    expect(vault.savedValues).toEqual(['rotated-refresh']);
    expect(vault.savedValues).not.toContain('access-secret');
  });

  it('returns signed out without making an empty token authoritative', async () => {
    const gateway = new SupabaseAuthGateway(
      new FakeAuth(),
      new FakeVault(),
      () => 'grant-id',
      () => nowMilliseconds,
    );
    await expect(gateway.restoreSession()).resolves.toEqual({
      ok: true,
      value: { kind: 'signedOut' },
    });
  });

  it('returns verification pending when signup creates no session', async () => {
    const auth = new FakeAuth();
    auth.response = {
      data: {
        session: null,
        user: session.user,
      },
      error: null,
    };
    const gateway = new SupabaseAuthGateway(
      auth,
      new FakeVault(),
      () => 'grant-id',
      () => nowMilliseconds,
    );

    await expect(gateway.signUpWithEmail({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    })).resolves.toEqual({
      ok: true,
      value: { kind: 'verificationPending', email: 'person@example.com' },
    });
  });

  it('reauthenticates a password account and returns a short-lived grant', async () => {
    const auth = new FakeAuth();
    const gateway = new SupabaseAuthGateway(
      auth,
      new FakeVault(),
      () => 'grant-id',
      () => nowMilliseconds,
    );

    await expect(gateway.reauthenticate({
      kind: 'password',
      password: 'correct horse battery staple',
    })).resolves.toEqual({
      ok: true,
      value: {
        value: 'grant-id',
        expiresAtMilliseconds:
          nowMilliseconds + reauthenticationGrantLifetimeMilliseconds,
      },
    });
    expect(auth.passwordCredentials).toEqual({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    });
  });

  it('maps retryable and rate-limited failures to stable errors', async () => {
    const auth = new FakeAuth();
    auth.response = {
      data: { session: null, user: null },
      error: { name: 'AuthRetryableFetchError', status: 0 },
    };
    const offline = new SupabaseAuthGateway(
      auth,
      new FakeVault(),
      () => 'grant-id',
      () => nowMilliseconds,
    );
    await expect(offline.signInWithEmail({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    })).resolves.toEqual({ ok: false, error: { code: 'offline' } });

    auth.response = {
      data: { session: null, user: null },
      error: { name: 'AuthApiError', status: 429 },
    };
    await expect(offline.signInWithEmail({
      email: 'person@example.com',
      password: 'correct horse battery staple',
    })).resolves.toEqual({ ok: false, error: { code: 'rateLimited' } });
  });

  it('consumes a recovery redirect and updates the password', async () => {
    const auth = new FakeAuth();
    const vault = new FakeVault();
    const gateway = new SupabaseAuthGateway(
      auth,
      vault,
      () => 'grant-id',
      () => nowMilliseconds,
    );
    const recoveryUrl =
      'kineo://auth/reset#type=recovery&access_token=access&refresh_token=refresh';

    await expect(gateway.completePasswordReset(
      recoveryUrl,
      'new correct horse battery staple',
    )).resolves.toEqual({
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    });
    expect(auth.updatedPassword).toBe('new correct horse battery staple');
    expect(vault.token).toBe('rotated-refresh');
  });

  it('consumes a verified-email callback into the secure session', async () => {
    const vault = new FakeVault();
    const gateway = new SupabaseAuthGateway(
      new FakeAuth(),
      vault,
      () => 'grant-id',
      () => nowMilliseconds,
    );
    await expect(gateway.completeEmailVerification(
      'kineo://auth/callback#type=signup&access_token=access&refresh_token=refresh',
    )).resolves.toEqual({
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    });
    expect(vault.token).toBe('rotated-refresh');
  });

  it('rejects unrelated deep links as recovery credentials', async () => {
    const gateway = new SupabaseAuthGateway(
      new FakeAuth(),
      new FakeVault(),
      () => 'grant-id',
      () => nowMilliseconds,
    );
    await expect(gateway.completePasswordReset(
      'https://example.com/reset#access_token=secret',
      'new correct horse battery staple',
    )).resolves.toEqual({
      ok: false,
      error: { code: 'invalidCredentials' },
    });
  });
});
