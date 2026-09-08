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
import type { RefreshTokenVault, StoredRefreshCredential } from './secure-refresh-token-vault';

const millisecondsPerSecond = 1_000;
const secondsPerMinute = 60;
const reauthenticationGrantLifetimeMinutes = 5;
// Stay ahead of auth-js's 90-second automatic-refresh margin. Data requests use
// a separate client; only this gateway may rotate/persist the product credential.
const accessTokenRefreshMarginSeconds = 2 * secondsPerMinute;
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
  expires_at?: number;
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

type UserResponse = Readonly<{
  data: Readonly<{ user: SupabaseUser | null }>;
  error: SupabaseAuthError | null;
}>;

export interface SupabaseAuthPort {
  refreshSession(input: Readonly<{ refresh_token: string }>): Promise<SessionResponse>;
  signInWithIdToken(input: Readonly<{
    provider: Extract<AuthProvider, 'apple' | 'google'>;
    token: string;
    nonce?: string;
  }>): Promise<SessionResponse>;
  signUp(input: EmailCredentials & Readonly<{
    options?: Readonly<{ emailRedirectTo: string }>;
  }>): Promise<SessionResponse>;
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
  setSession(input: Readonly<{
    access_token: string;
    refresh_token: string;
  }>): Promise<SessionResponse>;
  exchangeCodeForSession(code: string): Promise<SessionResponse>;
  updateUser(input: Readonly<{
    password: string;
    current_password?: string;
  }>): Promise<UserResponse>;
  getUser(): Promise<Readonly<{
    data: Readonly<{ user: SupabaseUser | null }>;
    error: SupabaseAuthError | null;
  }>>;
  signOut(input?: Readonly<{ scope: 'local' }>): Promise<
    Readonly<{ error: SupabaseAuthError | null }>
  >;
}

const retryableErrorName = 'AuthRetryableFetchError';
const missingSessionErrorName = 'AuthSessionMissingError';
const rateLimitedStatus = 429;
const firstServerErrorStatus = 500;
const unauthorizedStatus = 401;

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
  if (error.name === retryableErrorName || error.status === 0 ||
      (error.status !== undefined && error.status >= firstServerErrorStatus)) {
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
  if (error.status === unauthorizedStatus || error.code === 'refresh_token_not_found' ||
      error.code === 'refresh_token_already_used' || error.code === 'session_not_found') {
    return { code: 'sessionExpired' };
  }
  return { code: 'unexpected' };
}

export class SupabaseAuthGateway implements AuthGateway {
  private refreshInFlight?: Promise<AuthResult<AuthState>>;
  private accessSession?: Readonly<{ token: string; expiresAtSeconds: number }>;
  private loggingOut = false;
  private logoutSuspended = false;
  private authGeneration = Symbol();
  private readonly credentialWrites = new Set<Promise<AuthResult<void>>>();
  constructor(
    private readonly auth: SupabaseAuthPort,
    private readonly vault: RefreshTokenVault,
    private readonly nextGrantIdentifier: () => string,
    private readonly nowMilliseconds: () => number,
    private readonly emailRedirectUrl?: string,
    private readonly passwordResetRedirectUrl?: string,
    private readonly isolatedIdentityAuth?: () =>
      Pick<SupabaseAuthPort, 'signInWithIdToken'> | undefined,
  ) {}

  restoreSession(): Promise<AuthResult<AuthState>> {
    if (this.loggingOut) return Promise.resolve({ ok: false, error: { code: 'sessionExpired' } });
    this.refreshInFlight ??= this.performRestore().finally(() => { this.refreshInFlight = undefined; });
    return this.refreshInFlight;
  }

  async validAccessToken(): Promise<AuthResult<string>> {
    if (this.loggingOut) return { ok: false, error: { code: 'sessionExpired' } };
    const currentSeconds = this.nowMilliseconds() / millisecondsPerSecond;
    if (this.accessSession !== undefined &&
        this.accessSession.expiresAtSeconds - currentSeconds > accessTokenRefreshMarginSeconds) {
      return { ok: true, value: this.accessSession.token };
    }
    const restored = await this.restoreSession();
    if (!restored.ok) return restored;
    if (restored.value.kind === 'cached') return { ok: false, error: { code: 'offline' } };
    return restored.value.kind === 'authenticated' && this.accessSession !== undefined
      ? { ok: true, value: this.accessSession.token }
      : { ok: false, error: { code: 'sessionExpired' } };
  }

  private async performRestore(): Promise<AuthResult<AuthState>> {
    const generation = this.authGeneration;
    const stored = await this.vault.load();
    if (!stored.ok) return stored;
    if (stored.value === undefined) {
      this.accessSession = undefined;
      return { ok: true, value: { kind: 'signedOut' } };
    }

    let response: SessionResponse;
    try {
      response = await this.auth.refreshSession({
        refresh_token: stored.value.refreshToken,
      });
    } catch {
      return cachedIdentity(stored.value);
    }
    if (response.error !== null) {
      const mapped = stableAuthError(response.error);
      if (mapped.code === 'offline') return cachedIdentity(stored.value);
      if (mapped.code !== 'sessionExpired' && mapped.code !== 'invalidCredentials')
        return { ok: false, error: mapped };
      this.accessSession = undefined;
      const cleared = await this.vault.clear();
      return cleared.ok
        ? { ok: true, value: { kind: 'signedOut' } }
        : cleared;
    }
    if (stored.value.identity !== undefined &&
        response.data.session?.user.id !== stored.value.identity.accountId) {
      this.accessSession = undefined;
      return { ok: false, error: { code: 'invalidCredentials' } };
    }
    return this.persistSession(response, 'email', generation);
  }

  async signInWithIdentityToken(
    provider: Extract<AuthProvider, 'apple' | 'google'>,
    token: string,
    nonce?: string,
    purpose: 'signIn' | 'reauthenticate' = 'signIn',
  ): Promise<AuthResult<AuthState>> {
    const generation = this.authGeneration;
    try {
      let expectedAccountId: string | undefined;
      if (purpose === 'reauthenticate') {
        const current = await this.auth.getUser();
        if (current.error !== null || current.data.user === null ||
            this.isolatedIdentityAuth === undefined) {
          return { ok: false, error: { code: 'reauthenticationRequired' } };
        }
        expectedAccountId = current.data.user.id;
      }
      // A provider account picker may return a different person. Authenticate in
      // an isolated, nonpersistent client before replacing the product session.
      const identityAuth = purpose === 'reauthenticate'
        ? this.isolatedIdentityAuth?.()
        : this.auth;
      if (identityAuth === undefined) {
        return { ok: false, error: { code: 'reauthenticationRequired' } };
      }
      let response = await identityAuth.signInWithIdToken({
        provider,
        token,
        ...(nonce === undefined ? {} : { nonce }),
      });
      if (response.error !== null) {
        return { ok: false, error: stableAuthError(response.error) };
      }
      if (purpose === 'reauthenticate') {
        const session = response.data.session;
        if (session === null || session.user.id !== expectedAccountId) {
          return { ok: false, error: { code: 'reauthenticationRequired' } };
        }
        response = await this.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
      return response.error === null
        ? this.persistSession(response, provider, generation)
        : { ok: false, error: stableAuthError(response.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async signUpWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>> {
    const generation = this.authGeneration;
    try {
      const response = await this.auth.signUp({
        ...credentials,
        ...(this.emailRedirectUrl === undefined ? {} : {
          options: { emailRedirectTo: this.emailRedirectUrl },
        }),
      });
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
      return this.persistSession(response, 'email', generation);
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async signInWithEmail(
    credentials: EmailCredentials,
  ): Promise<AuthResult<AuthState>> {
    const generation = this.authGeneration;
    try {
      const response = await this.auth.signInWithPassword(credentials);
      return response.error === null
        ? this.persistSession(response, 'email', generation)
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

  async completeEmailVerification(
    callbackUrl: string,
  ): Promise<AuthResult<AuthState>> {
    const credential = parseRedirectCredential(callbackUrl, '/callback');
    return credential === undefined
      ? { ok: false, error: { code: 'invalidCredentials' } }
      : this.consumeRedirectCredential(credential);
  }

  async completePasswordReset(
    recoveryUrl: string,
    newPassword: string,
  ): Promise<AuthResult<AuthState>> {
    const credential = parseRedirectCredential(recoveryUrl, '/reset', 'recovery');
    if (credential === undefined) {
      return { ok: false, error: { code: 'invalidCredentials' } };
    }
    try {
      const session = await this.consumeRedirectCredential(credential);
      if (!session.ok) return session;
      const updated = await this.auth.updateUser({ password: newPassword });
      return updated.error === null
        ? session
        : { ok: false, error: stableAuthError(updated.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async updatePassword(
    newPassword: string,
    currentPassword: string,
  ): Promise<AuthResult<void>> {
    try {
      const updated = await this.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });
      return updated.error === null
        ? { ok: true, value: undefined }
        : { ok: false, error: stableAuthError(updated.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async reauthenticate(
    method: ReauthenticationMethod,
  ): Promise<AuthResult<ReauthenticationGrant>> {
    const generation = this.authGeneration;
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
      const persisted = await this.persistSession(response, 'email', generation);
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

  async suspendForLogout(): Promise<void> {
    this.loggingOut = true;
    await this.refreshInFlight;
    await Promise.all(this.credentialWrites);
    this.authGeneration = Symbol();
    this.logoutSuspended = true;
    this.accessSession = undefined;
  }

  resumeAfterLogout(): void {
    this.accessSession = undefined;
    this.logoutSuspended = false;
    this.loggingOut = false;
  }

  async logout(): Promise<AuthResult<void>> {
    this.loggingOut = true;
    try {
      // A refresh started before logout must not repersist a credential after
      // the wipe. Block new refreshes and drain the existing one first.
      await this.refreshInFlight;
      const response = await this.auth.signOut({ scope: 'local' });
      if (
        response.error !== null &&
        response.error.name !== missingSessionErrorName
      ) {
        return { ok: false, error: stableAuthError(response.error) };
      }
      this.accessSession = undefined;
      return this.vault.clear();
    } catch {
      return { ok: false, error: { code: 'offline' } };
    } finally {
      this.loggingOut = false;
    }
  }

  private async persistSession(
    response: SessionResponse,
    fallbackProvider: AuthProvider,
    generation: symbol,
  ): Promise<AuthResult<AuthState>> {
    if (this.logoutSuspended || generation !== this.authGeneration) {
      return { ok: false, error: { code: 'sessionExpired' } };
    }
    const session = response.data.session;
    if (session === null || session.user.id.length === 0) {
      return { ok: false, error: { code: 'invalidCredentials' } };
    }
    const writing = this.vault.save({
      refreshToken: session.refresh_token,
      identity: { accountId: session.user.id, provider: providerFor(session.user, fallbackProvider) },
    });
    this.credentialWrites.add(writing);
    const stored = await writing.finally(() => { this.credentialWrites.delete(writing); });
    if (!stored.ok) return stored;
    this.accessSession = {
      token: session.access_token,
      expiresAtSeconds: session.expires_at ?? this.nowMilliseconds() / millisecondsPerSecond,
    };
    return {
      ok: true,
      value: {
        kind: 'authenticated',
        accountId: session.user.id,
        provider: providerFor(session.user, fallbackProvider),
      },
    };
  }

  private async consumeRedirectCredential(
    credential: RecoveryCredential,
  ): Promise<AuthResult<AuthState>> {
    const generation = this.authGeneration;
    try {
      const response = credential.kind === 'code'
        ? await this.auth.exchangeCodeForSession(credential.code)
        : await this.auth.setSession({
            access_token: credential.accessToken,
            refresh_token: credential.refreshToken,
          });
      return response.error === null
        ? this.persistSession(response, 'email', generation)
        : { ok: false, error: stableAuthError(response.error) };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }
}

function cachedIdentity(credential: StoredRefreshCredential): AuthResult<AuthState> {
  return credential.identity === undefined
    ? { ok: false, error: { code: 'offline' } }
    : { ok: true, value: { kind: 'cached', ...credential.identity } };
}

type RecoveryCredential =
  | Readonly<{ kind: 'code'; code: string }>
  | Readonly<{
      kind: 'tokens';
      accessToken: string;
      refreshToken: string;
    }>;

function parseRedirectCredential(
  url: string,
  expectedPath: '/callback' | '/reset',
  expectedType?: string,
): RecoveryCredential | undefined {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'kineo:' ||
      parsed.hostname !== 'auth' ||
      parsed.pathname !== expectedPath
    ) return undefined;
    const code = parsed.searchParams.get('code');
    if (code !== null && code.length > 0) return { kind: 'code', code };
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (
      (expectedType !== undefined && fragment.get('type') !== expectedType) ||
      accessToken === null ||
      accessToken.length === 0 ||
      refreshToken === null ||
      refreshToken.length === 0
    ) return undefined;
    return { kind: 'tokens', accessToken, refreshToken };
  } catch {
    return undefined;
  }
}
