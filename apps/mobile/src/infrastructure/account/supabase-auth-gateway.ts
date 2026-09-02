import type { EmailCredentials } from '../../core/account/account-domain';
import type {
  AuthError,
  AuthProvider,
  AuthResult,
  AuthState,
  ReauthenticationGrant,
  ReauthenticationMethod,
} from '../../core/account/auth-module';
import type { AuthGateway } from '../../application/account/kineo-auth-module';
import type { RefreshTokenVault } from './secure-refresh-token-vault';

const millisecondsPerSecond = 1_000;
const secondsPerMinute = 60;
const reauthenticationGrantLifetimeMinutes = 5;
export const reauthenticationGrantLifetimeMilliseconds =
  reauthenticationGrantLifetimeMinutes *
  secondsPerMinute *
  millisecondsPerSecond;

type SupabaseUser = Readonly<{
  id: string;
  email?: string | null;
  app_metadata?: Readonly<Record<string, unknown>>;
}>;

export type SupabaseSession = Readonly<{
  access_token: string;
  refresh_token: string;
  user: SupabaseUser;
}>;

type SupabaseAuthError = Readonly<{
  name: string;
  status?: number;
  code?: string;
}>;

type SessionResponse = Readonly<{
  data: Readonly<{
    session: SupabaseSession | null;
    user: SupabaseUser | null;
  }>;
  error: SupabaseAuthError | null;
}>;

export interface SupabaseAuthPort {
  refreshSession(input: Readonly<{ refresh_token: string }>): Promise<SessionResponse>;
  signInWithIdToken(input: Readonly<{
    provider: Extract<AuthProvider, 'apple' | 'google'>;
    token: string;
    nonce?: string;
  }>): Promise<SessionResponse>;
  signUp(input: EmailCredentials): Promise<SessionResponse>;
  signInWithPassword(input: EmailCredentials): Promise<SessionResponse>;
  resend(input: Readonly<{
    type: 'signup';
    email: string;
    options?: Readonly<{ emailRedirectTo?: string }>;
  }>): Promise<SessionResponse>;
  resetPasswordForEmail(
    email: string,
    options?: Readonly<{ redirectTo?: string }>,
  ): Promise<Readonly<{
    data: object | null;
    error: SupabaseAuthError | null;
  }>>;
  getUser(): Promise<Readonly<{
    data: Readonly<{ user: SupabaseUser | null }>;
    error: SupabaseAuthError | null;
  }>>;
  signOut(input?: Readonly<{ scope: 'global' }>): Promise<
    Readonly<{ error: SupabaseAuthError | null }>
  >;
}

const retryableErrorName = 'AuthRetryableFetchError';
const missingSessionErrorName = 'AuthSessionMissingError';
const rateLimitedStatus = 429;

function providerFor(
  user: SupabaseUser,
  fallback: AuthProvider,
): AuthProvider {
  const provider = user.app_metadata?.provider;
  return provider === 'apple' || provider === 'google' || provider === 'email'
    ? provider
    : fallback;
}

function stableAuthError(error: SupabaseAuthError): AuthError {
  if (error.name === retryableErrorName || error.status === 0) {
    return { code: 'offline' };
  }
  if (error.status === rateLimitedStatus) {
    return { code: 'rateLimited' };
  }
  if (error.code === 'email_not_confirmed') {
    return { code: 'verificationRequired' };
  }
  if (
    error.code === 'invalid_credentials' ||
    error.code === 'user_not_found'
  ) {
    return { code: 'invalidCredentials' };
  }
  if (error.code === 'weak_password') {
    return { code: 'invalidInput' };
  }
  return { code: 'unexpected' };
}

export class SupabaseAuthGateway implements AuthGateway {
  constructor(
    private readonly auth: SupabaseAuthPort,
    private readonly vault: RefreshTokenVault,
    private readonly nextGrantIdentifier: () => string,
    private readonly nowMilliseconds: () => number,
    private readonly emailRedirectUrl?: string,
    private readonly passwordResetRedirectUrl?: string,
  ) {}

  async restoreSession(): Promise<AuthResult<AuthState>> {
    const stored = await this.vault.load();
    if (!stored.ok) return stored;
    if (stored.value === undefined) {
      return { ok: true, value: { kind: 'signedOut' } };
    }

    let response: SessionResponse;
    try {
      response = await this.auth.refreshSession({
        refresh_token: stored.value,
      });
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
    if (response.error !== null) {
      const mapped = stableAuthError(response.error);
      if (mapped.code === 'offline' || mapped.code === 'rateLimited') {
        return { ok: false, error: mapped };
      }
      const cleared = await this.vault.clear();
      return cleared.ok
        ? { ok: true, value: { kind: 'signedOut' } }
        : cleared;
    }
    return this.persistSession(response, 'email');
  }

  async signInWithIdentityToken(
    provider: Extract<AuthProvider, 'apple' | 'google'>,
    token: string,
    nonce?: string,
  ): Promise<AuthResult<AuthState>> {
    try {
      const response = await this.auth.signInWithIdToken({
        provider,
        token,
        ...(nonce === undefined ? {} : { nonce }),
      });
      return response.error === null
        ? this.persistSession(response, provider)
        : { ok: false, error: stableAuthError(response.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async signUpWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>> {
    try {
      const response = await this.auth.signUp(credentials);
      if (response.error !== null) {
        return { ok: false, error: stableAuthError(response.error) };
      }
      if (response.data.session === null) {
        return {
          ok: true,
          value: {
            kind: 'verificationPending',
            email: credentials.email,
          },
        };
      }
      return this.persistSession(response, 'email');
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async signInWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>> {
    try {
      const response = await this.auth.signInWithPassword(credentials);
      return response.error === null
        ? this.persistSession(response, 'email')
        : { ok: false, error: stableAuthError(response.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async resendVerification(email: string): Promise<AuthResult<void>> {
    try {
      const response = await this.auth.resend({
        type: 'signup',
        email,
        ...(this.emailRedirectUrl === undefined
          ? {}
          : { options: { emailRedirectTo: this.emailRedirectUrl } }),
      });
      return response.error === null
        ? { ok: true, value: undefined }
        : { ok: false, error: stableAuthError(response.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async requestPasswordReset(email: string): Promise<AuthResult<void>> {
    try {
      const response = await this.auth.resetPasswordForEmail(
        email,
        this.passwordResetRedirectUrl === undefined
          ? undefined
          : { redirectTo: this.passwordResetRedirectUrl },
      );
      return response.error === null
        ? { ok: true, value: undefined }
        : { ok: false, error: stableAuthError(response.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async reauthenticate(
    method: ReauthenticationMethod,
  ): Promise<AuthResult<ReauthenticationGrant>> {
    if (method.kind !== 'password') {
      return {
        ok: false,
        error: { code: 'providerUnavailable', provider: method.kind },
      };
    }
    try {
      const current = await this.auth.getUser();
      const email = current.data.user?.email;
      if (current.error !== null || email === null || email === undefined) {
        return { ok: false, error: { code: 'invalidCredentials' } };
      }
      const response = await this.auth.signInWithPassword({
        email,
        password: method.password,
      });
      if (response.error !== null) {
        return { ok: false, error: stableAuthError(response.error) };
      }
      const persisted = await this.persistSession(response, 'email');
      return persisted.ok
        ? this.createReauthenticationGrant()
        : persisted;
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async createReauthenticationGrant(): Promise<
    AuthResult<ReauthenticationGrant>
  > {
    const value = this.nextGrantIdentifier();
    const now = this.nowMilliseconds();
    if (value.length === 0 || !Number.isSafeInteger(now) || now <= 0) {
      return { ok: false, error: { code: 'unexpected' } };
    }
    return {
      ok: true,
      value: {
        value,
        expiresAtMilliseconds:
          now + reauthenticationGrantLifetimeMilliseconds,
      },
    };
  }

  async logout(): Promise<AuthResult<void>> {
    try {
      const response = await this.auth.signOut({ scope: 'global' });
      if (
        response.error !== null &&
        response.error.name !== missingSessionErrorName
      ) {
        return { ok: false, error: stableAuthError(response.error) };
      }
      return this.vault.clear();
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  private async persistSession(
    response: SessionResponse,
    fallbackProvider: AuthProvider,
  ): Promise<AuthResult<AuthState>> {
    const session = response.data.session;
    if (session === null || session.user.id.length === 0) {
      return { ok: false, error: { code: 'invalidCredentials' } };
    }
    const stored = await this.vault.save(session.refresh_token);
    if (!stored.ok) return stored;
    return {
      ok: true,
      value: {
        kind: 'authenticated',
        accountId: session.user.id,
        provider: providerFor(session.user, fallbackProvider),
      },
    };
  }
}
