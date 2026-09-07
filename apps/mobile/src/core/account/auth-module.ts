import type { EmailCredentials } from './account-domain';
import type { Result } from '../shared/result';

export type AuthProvider = 'apple' | 'google' | 'email';

export type AuthState =
  | Readonly<{ kind: 'signedOut' }>
  | Readonly<{
      kind: 'verificationPending';
      email: string;
    }>
  | Readonly<{
      kind: 'authenticated';
      accountId: string;
      provider: AuthProvider;
    }>;

export type ReauthenticationMethod =
  | Readonly<{ kind: 'apple' }>
  | Readonly<{ kind: 'google' }>
  | Readonly<{ kind: 'password'; password: string }>;

export type ReauthenticationGrant = Readonly<{
  value: string;
  expiresAtMilliseconds: number;
}>;

export type LogoutPolicy = 'waitForSync' | 'discardPendingChanges';

export type AuthError =
  | Readonly<{ code: 'cancelled' }>
  | Readonly<{ code: 'invalidInput' }>
  | Readonly<{ code: 'verificationRequired' }>
  | Readonly<{ code: 'invalidCredentials' }>
  | Readonly<{ code: 'rateLimited'; retryAfterMilliseconds?: number }>
  | Readonly<{ code: 'offline' }>
  | Readonly<{ code: 'providerUnavailable'; provider: AuthProvider }>
  | Readonly<{ code: 'sessionExpired' }>
  | Readonly<{ code: 'reauthenticationRequired' }>
  | Readonly<{ code: 'secureStorageUnavailable' }>
  | Readonly<{ code: 'pendingChanges' }>
  | Readonly<{ code: 'unexpected' }>;

export type AuthResult<Value> = Result<Value, AuthError>;

export interface AuthModule {
  restoreSession(): Promise<AuthResult<AuthState>>;
  signInWithApple(): Promise<AuthResult<AuthState>>;
  signInWithGoogle(): Promise<AuthResult<AuthState>>;
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
  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResult<void>>;
  reauthenticate(
    method: ReauthenticationMethod,
  ): Promise<AuthResult<ReauthenticationGrant>>;
  logout(policy: LogoutPolicy): Promise<AuthResult<void>>;
}
