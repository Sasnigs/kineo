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
  pending = false;

  async hasPendingMutations(): Promise<AuthResult<boolean>> {
    return { ok: true, value: this.pending };
  }

  async flushPendingMutations(): Promise<AuthResult<void>> {
    this.actions.push('flush');
    return { ok: true, value: undefined };
  }

  async discardPendingMutations(): Promise<AuthResult<void>> {
    this.actions.push('discard');
    return { ok: true, value: undefined };
  }

  async revokeInstallation(): Promise<AuthResult<void>> {
    this.actions.push('revoke');
    return { ok: true, value: undefined };
  }

  async wipeLocalAccount(): Promise<AuthResult<void>> {
    this.actions.push('wipe');
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

  it.each<Readonly<{ policy: LogoutPolicy; expectedAction: string }>>([
    { policy: 'waitForSync', expectedAction: 'flush' },
    { policy: 'discardPendingChanges', expectedAction: 'discard' },
  ])('resolves pending work before revoke, logout, and local wipe', async ({
    policy,
    expectedAction,
  }) => {
    const { module, gateway, logout } = makeModule();
    logout.pending = true;
    await expect(module.logout(policy)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(logout.actions).toEqual([expectedAction, 'revoke', 'wipe']);
    expect(gateway.logoutCount).toBe(1);
  });

  it('does not wipe local data if remote logout fails', async () => {
    const gateway = new FakeGateway();
    jest.spyOn(gateway, 'logout').mockResolvedValue({
      ok: false,
      error: { code: 'offline' },
    });
    const { module, logout } = makeModule(gateway);
    await expect(module.logout('waitForSync')).resolves.toEqual({
      ok: false,
      error: { code: 'offline' },
    });
    expect(logout.actions).toEqual(['revoke']);
  });
});
