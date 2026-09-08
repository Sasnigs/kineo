import { describe, expect, it, jest } from '@jest/globals';

import type {
  AuthError,
  AuthProvider,
  AuthResult,
  AuthState,
  LogoutPolicy,
  ReauthenticationMethod,
} from '../../core/account/auth-module';
import type { EmailCredentials } from '../../core/account/account-domain';
import {
  KineoAuthModule,
  type AuthGateway,
  type IdentityTokenProvider,
  type LogoutCoordinator,
} from './kineo-auth-module';
import type { LogoutRecoveryState } from './kineo-logout-workflow';

const accountId = '10000000-0000-4000-8000-000000000001';
const validCredentials: EmailCredentials = {
  email: 'person@example.com',
  password: 'correct horse battery staple',
};

class FakeGateway implements AuthGateway {
  restoreCount = 0;
  signInToken?: Readonly<{ provider: AuthProvider; token: string; nonce?: string }>;
  signupCredentials?: EmailCredentials;
  logoutCount = 0;

  async restoreSession(): Promise<AuthResult<AuthState>> {
    this.restoreCount += 1;
    return {
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    };
  }

  async signInWithIdentityToken(
    provider: Extract<AuthProvider, 'apple' | 'google'>,
    token: string,
    nonce?: string,
  ): Promise<AuthResult<AuthState>> {
    this.signInToken = { provider, token, ...(nonce === undefined ? {} : { nonce }) };
    return {
      ok: true,
      value: { kind: 'authenticated', accountId, provider },
    };
  }

  async signUpWithEmail(credentials: EmailCredentials): Promise<AuthResult<AuthState>> {
    this.signupCredentials = credentials;
    return {
      ok: true,
      value: { kind: 'verificationPending', email: credentials.email },
    };
  }

  async signInWithEmail(): Promise<AuthResult<AuthState>> {
    return {
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    };
  }

  async resendVerification(): Promise<AuthResult<void>> {
    return { ok: true, value: undefined };
  }

  async requestPasswordReset(): Promise<AuthResult<void>> {
    return { ok: true, value: undefined };
  }

  async completePasswordReset(): Promise<AuthResult<AuthState>> {
    return {
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    };
  }

  async completeEmailVerification(): Promise<AuthResult<AuthState>> {
    return {
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'email' },
    };
  }

  async updatePassword(): Promise<AuthResult<void>> {
    return { ok: true, value: undefined };
  }

  async reauthenticate(
    _method: ReauthenticationMethod,
  ): Promise<AuthResult<{ value: string; expiresAtMilliseconds: number }>> {
    return {
      ok: true,
      value: { value: 'grant', expiresAtMilliseconds: 1_788_300_300_000 },
    };
  }

  async createReauthenticationGrant(): Promise<
    AuthResult<{ value: string; expiresAtMilliseconds: number }>
  > {
    return {
      ok: true,
      value: { value: 'grant', expiresAtMilliseconds: 1_788_300_300_000 },
    };
  }

  async logout(): Promise<AuthResult<void>> {
    this.logoutCount += 1;
    return { ok: true, value: undefined };
  }
}

class FakeIdentityProvider implements IdentityTokenProvider {
  constructor(
    private readonly result: AuthResult<Readonly<{ token: string; nonce?: string }>>,
  ) {}

  async acquireIdentityToken() {
    return this.result;
  }
}

class FakeLogoutCoordinator implements LogoutCoordinator {
  readonly actions: string[] = [];
  recovery: AuthResult<LogoutRecoveryState> = { ok: true, value: { kind: 'none' } };

  async resumePendingLogout(): Promise<AuthResult<LogoutRecoveryState>> {
    return this.recovery;
  }

  async logout(policy: LogoutPolicy): Promise<AuthResult<void>> {
    this.actions.push(policy);
    return { ok: true, value: undefined };
  }
}

function makeModule(
  gateway = new FakeGateway(),
  apple: IdentityTokenProvider = new FakeIdentityProvider({
    ok: true,
    value: { token: 'apple-token', nonce: 'apple-nonce' },
  }),
  google: IdentityTokenProvider = new FakeIdentityProvider({
    ok: true,
    value: { token: 'google-token' },
  }),
  logout = new FakeLogoutCoordinator(),
) {
  return {
    module: new KineoAuthModule(gateway, apple, google, logout),
    gateway,
    logout,
  };
}

describe('KineoAuthModule', () => {
  it('serializes concurrent session restoration', async () => {
    const { module, gateway } = makeModule();
    const [first, second] = await Promise.all([
      module.restoreSession(),
      module.restoreSession(),
    ]);
    expect(first).toEqual(second);
    expect(gateway.restoreCount).toBe(1);
  });

  it('passes a native Apple token and nonce to the Auth gateway', async () => {
    const { module, gateway } = makeModule();
    await expect(module.signInWithApple()).resolves.toEqual({
      ok: true,
      value: { kind: 'authenticated', accountId, provider: 'apple' },
    });
    expect(gateway.signInToken).toEqual({
      provider: 'apple',
      token: 'apple-token',
      nonce: 'apple-nonce',
    });
  });

  it('preserves provider cancellation without contacting the Auth gateway', async () => {
    const cancelled: AuthError = { code: 'cancelled' };
    const { module, gateway } = makeModule(
      new FakeGateway(),
      new FakeIdentityProvider({ ok: false, error: cancelled }),
    );
    await expect(module.signInWithApple()).resolves.toEqual({
      ok: false,
      error: cancelled,
    });
    expect(gateway.signInToken).toBeUndefined();
  });

  it('validates and normalizes email credentials before signup', async () => {
    const { module, gateway } = makeModule();
    await module.signUpWithEmail({
      ...validCredentials,
      email: ' PERSON@Example.com ',
    });
    expect(gateway.signupCredentials).toEqual(validCredentials);

    await expect(module.signUpWithEmail({
      email: 'invalid',
      password: validCredentials.password,
    })).resolves.toEqual({ ok: false, error: { code: 'invalidInput' } });
  });

  it('reauthenticates social accounts through their native provider', async () => {
    const { module, gateway } = makeModule();
    await expect(module.reauthenticate({ kind: 'google' })).resolves.toEqual({
      ok: true,
      value: {
        value: 'grant',
        expiresAtMilliseconds: 1_788_300_300_000,
      },
    });
    expect(gateway.signInToken).toEqual({
      provider: 'google',
      token: 'google-token',
    });
  });

  it('rejects a short replacement password before calling the gateway', async () => {
    const { module, gateway } = makeModule();
    const update = jest.spyOn(gateway, 'updatePassword');

    await expect(module.changePassword('current password', 'short')).resolves.toEqual({
      ok: false,
      error: { code: 'invalidInput' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each<LogoutPolicy>(['waitForSync', 'discardPendingChanges'])('delegates %s to durable logout', async (policy) => {
    const { module, gateway, logout } = makeModule();
    await expect(module.logout(policy)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(logout.actions).toEqual([policy]);
    expect(gateway.logoutCount).toBe(0);
  });

  it('blocks restored cache and every login path while remote logout recovery is pending', async () => {
    const { module, gateway, logout } = makeModule();
    logout.recovery = { ok: true, value: { kind: 'pending', localWiped: true, error: { code: 'offline' } } };
    const signIn = jest.spyOn(gateway, 'signInWithEmail');
    for (const result of await Promise.all([
      module.restoreSession(), module.signInWithEmail(validCredentials),
      module.signUpWithEmail(validCredentials), module.signInWithApple(),
      module.completeEmailVerification('kineo://auth/callback'),
      module.completePasswordReset('kineo://auth/reset', validCredentials.password),
    ])) expect(result).toEqual({ ok: false, error: { code: 'offline' } });
    expect(gateway.restoreCount).toBe(0);
    expect(signIn).not.toHaveBeenCalled();
    expect(gateway.signInToken).toBeUndefined();
    expect(gateway.signupCredentials).toBeUndefined();
  });
});
