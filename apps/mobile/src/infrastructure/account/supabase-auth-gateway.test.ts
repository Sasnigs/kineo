import { describe, expect, it } from '@jest/globals';

import type { AuthResult } from '../../core/account/auth-module';
import {
  SupabaseAuthGateway,
  reauthenticationGrantLifetimeMilliseconds,
  type SupabaseAuthPort,
  type SupabaseSession,
} from './supabase-auth-gateway';
import type { RefreshTokenVault } from './secure-refresh-token-vault';

const accountId = '10000000-0000-4000-8000-000000000001';
const nowMilliseconds = 1_788_300_000_000;

class FakeVault implements RefreshTokenVault {
  token?: string;
  savedValues: string[] = [];

  async load(): Promise<AuthResult<string | undefined>> {
    return { ok: true, value: this.token };
  }

  async save(refreshToken: string): Promise<AuthResult<void>> {
    this.token = refreshToken;
    this.savedValues.push(refreshToken);
    return { ok: true, value: undefined };
  }

  async clear(): Promise<AuthResult<void>> {
    this.token = undefined;
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
  response: Awaited<ReturnType<SupabaseAuthPort['refreshSession']>> = {
    data: { session, user: session.user },
    error: null,
  };
  passwordCredentials?: Readonly<{ email: string; password: string }>;

  async refreshSession() {
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

  async getUser() {
    return { data: { user: session.user }, error: null };
  }

  async signOut() {
    return { error: null };
  }
}

describe('SupabaseAuthGateway', () => {
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
});
