import {
  validateEmailAddress,
  validateEmailCredentials,
  validatePassword,
  type EmailCredentials,
} from '../../core/account/account-domain';
import {
  type AuthError,
  type AuthModule,
  type AuthProvider,
  type AuthResult,
  type AuthState,
  type LogoutPolicy,
  type ReauthenticationGrant,
  type ReauthenticationMethod,
} from '../../core/account/auth-module';
import type { LogoutRecoveryState } from './kineo-logout-workflow';

export interface IdentityTokenProvider {
  acquireIdentityToken(): Promise<
    AuthResult<Readonly<{ token: string; nonce?: string }>>
  >;
}

export interface AuthGateway {
  restoreSession(): Promise<AuthResult<AuthState>>;
  signInWithIdentityToken(
    provider: Extract<AuthProvider, 'apple' | 'google'>,
    token: string,
    nonce?: string,
    purpose?: 'signIn' | 'reauthenticate',
  ): Promise<AuthResult<AuthState>>;
  signUpWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>>;
  signInWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>>;
  resendVerification(email: string): Promise<AuthResult<void>>;
  requestPasswordReset(email: string): Promise<AuthResult<void>>;
  completeEmailVerification(
    callbackUrl: string,
  ): Promise<AuthResult<AuthState>>;
  completePasswordReset(
    recoveryUrl: string,
    newPassword: string,
  ): Promise<AuthResult<AuthState>>;
  updatePassword(
    newPassword: string,
    currentPassword: string,
  ): Promise<AuthResult<void>>;
  reauthenticate(
    method: ReauthenticationMethod,
  ): Promise<AuthResult<ReauthenticationGrant>>;
  createReauthenticationGrant(): Promise<AuthResult<ReauthenticationGrant>>;
  logout(): Promise<AuthResult<void>>;
}

export interface LogoutCoordinator {
  logout(policy: LogoutPolicy): Promise<AuthResult<void>>;
  resumePendingLogout(): Promise<AuthResult<LogoutRecoveryState>>;
}

function invalidInput(): AuthResult<never> {
  return { ok: false, error: { code: 'invalidInput' } };
}

export class KineoAuthModule implements AuthModule {
  private restoreInFlight?: Promise<AuthResult<AuthState>>;

  constructor(
    private readonly gateway: AuthGateway,
    private readonly appleIdentity: IdentityTokenProvider,
    private readonly googleIdentity: IdentityTokenProvider,
    private readonly logoutCoordinator: LogoutCoordinator,
  ) {}

  restoreSession(): Promise<AuthResult<AuthState>> {
    this.restoreInFlight ??= this.withLogoutRecovery(() => this.gateway.restoreSession()).finally(() => {
      this.restoreInFlight = undefined;
    });
    return this.restoreInFlight;
  }

  signInWithApple(): Promise<AuthResult<AuthState>> {
    return this.signInWithNativeProvider('apple', this.appleIdentity);
  }

  signInWithGoogle(): Promise<AuthResult<AuthState>> {
    return this.signInWithNativeProvider('google', this.googleIdentity);
  }

  async signUpWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>> {
    const valid = validateEmailCredentials(credentials);
    return valid.ok
      ? this.withLogoutRecovery(() => this.gateway.signUpWithEmail(valid.value))
      : invalidInput();
  }

  async signInWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>> {
    const valid = validateEmailCredentials(credentials);
    return valid.ok
      ? this.withLogoutRecovery(() => this.gateway.signInWithEmail(valid.value))
      : invalidInput();
  }

  async resendVerification(email: string): Promise<AuthResult<void>> {
    const valid = validateEmailAddress(email);
    return valid.ok
      ? this.gateway.resendVerification(valid.value)
      : invalidInput();
  }

  async requestPasswordReset(email: string): Promise<AuthResult<void>> {
    const valid = validateEmailAddress(email);
    return valid.ok
      ? this.gateway.requestPasswordReset(valid.value)
      : invalidInput();
  }

  completeEmailVerification(
    callbackUrl: string,
  ): Promise<AuthResult<AuthState>> {
    return callbackUrl.length > 0
      ? this.withLogoutRecovery(() => this.gateway.completeEmailVerification(callbackUrl))
      : Promise.resolve(invalidInput());
  }

  async completePasswordReset(
    recoveryUrl: string,
    newPassword: string,
  ): Promise<AuthResult<AuthState>> {
    const password = validatePassword(newPassword);
    return password.ok && recoveryUrl.length > 0
      ? this.withLogoutRecovery(() => this.gateway.completePasswordReset(recoveryUrl, password.value))
      : invalidInput();
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResult<void>> {
    const password = validatePassword(newPassword);
    if (!password.ok || currentPassword.length === 0) return invalidInput();
    const verified = await this.gateway.reauthenticate({
      kind: 'password',
      password: currentPassword,
    });
    return verified.ok
      ? this.gateway.updatePassword(password.value, currentPassword)
      : verified;
  }

  async reauthenticate(
    method: ReauthenticationMethod,
  ): Promise<AuthResult<ReauthenticationGrant>> {
    if (method.kind === 'password') {
      return this.gateway.reauthenticate(method);
    }
    const provider = method.kind;
    const identity = provider === 'apple'
      ? this.appleIdentity
      : this.googleIdentity;
    const acquired = await identity.acquireIdentityToken();
    if (!acquired.ok) return acquired;
    const authenticated = await this.gateway.signInWithIdentityToken(
      provider,
      acquired.value.token,
      acquired.value.nonce,
      'reauthenticate',
    );
    return authenticated.ok
      ? this.gateway.createReauthenticationGrant()
      : authenticated;
  }

  async logout(policy: LogoutPolicy): Promise<AuthResult<void>> {
    await this.restoreInFlight;
    return this.logoutCoordinator.logout(policy);
  }

  private async withLogoutRecovery<Value>(operation: () => Promise<AuthResult<Value>>): Promise<AuthResult<Value>> {
    const recovered = await this.logoutCoordinator.resumePendingLogout();
    if (!recovered.ok) return recovered;
    return recovered.value.kind === 'pending'
      ? { ok: false, error: recovered.value.error }
      : operation();
  }

  private async signInWithNativeProvider(
    provider: Extract<AuthProvider, 'apple' | 'google'>,
    identity: IdentityTokenProvider,
  ): Promise<AuthResult<AuthState>> {
    return this.withLogoutRecovery(async () => {
      const acquired = await identity.acquireIdentityToken();
      if (!acquired.ok) return acquired;
      if (acquired.value.token.length === 0) {
        const error: AuthError = { code: 'invalidCredentials' };
        return { ok: false, error };
      }
      return this.gateway.signInWithIdentityToken(
        provider,
        acquired.value.token,
        acquired.value.nonce,
      );
    });
  }
}
