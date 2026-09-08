import type { LogoutOperations, LogoutIntent, LogoutCredential } from '../../application/account/kineo-logout-workflow';
import { validateEmailCredentials, type EmailCredentials } from '../../core/account/account-domain';
import type { AuthResult } from '../../core/account/auth-module';
import { SupabaseAuthGateway, type SupabaseAuthPort } from './supabase-auth-gateway';
import type { SupabaseFunctionsPort } from './supabase-sync-transport';

export type LogoutRecoverySignIn =
  | Readonly<{ kind: 'email'; credentials: EmailCredentials }>
  | Readonly<{ kind: 'identityToken'; provider: 'apple' | 'google'; token: string; nonce?: string }>;

/** Uses an isolated, nonpersistent Auth client and only the logout marker vault. */
export class SupabaseLogoutRecovery {
  constructor(
    private readonly makeAuth: () => SupabaseAuthPort | undefined,
    private readonly functions: SupabaseFunctionsPort,
    private readonly nowMilliseconds: () => number,
  ) {}

  async reauthenticate(intent: LogoutIntent, input: LogoutRecoverySignIn): Promise<AuthResult<LogoutCredential>> {
    const expectedAccountId = intent.credential.identity?.accountId;
    if (expectedAccountId === undefined) return { ok: false, error: { code: 'reauthenticationRequired' } };
    const auth = this.makeAuth();
    if (auth === undefined) return { ok: false, error: { code: 'unexpected' } };
    let credential: LogoutCredential | undefined;
    const isolated = new SupabaseAuthGateway(auth, {
      load: async () => ({ ok: true, value: undefined }),
      save: async (value) => { credential = value; return { ok: true, value: undefined }; },
      clear: async () => { credential = undefined; return { ok: true, value: undefined }; },
    }, () => '', this.nowMilliseconds);
    if (input.kind === 'email') {
      const valid = validateEmailCredentials(input.credentials);
      if (!valid.ok) return { ok: false, error: { code: 'invalidInput' } };
      const signedIn = await isolated.signInWithEmail(valid.value);
      if (!signedIn.ok) return signedIn;
    } else {
      const signedIn = await isolated.signInWithIdentityToken(input.provider, input.token, input.nonce);
      if (!signedIn.ok) return signedIn;
    }
    if (credential?.identity?.accountId !== expectedAccountId) {
      const cleared = await isolated.logout();
      return cleared.ok ? { ok: false, error: { code: 'reauthenticationRequired' } } : cleared;
    }
    return { ok: true, value: credential };
  }

  readonly revokeInstallation: LogoutOperations['revokeInstallation'] = async (intent, saveCredential) => {
    const gateway = this.gateway(intent, saveCredential);
    if (gateway === undefined) return { ok: false, error: { code: 'unexpected' } };
    const token = await gateway.validAccessToken();
    if (!token.ok) return token;
    try {
      const response = await this.functions.invoke('revoke-installation', {
        body: { installationId: intent.installationId },
        headers: { Authorization: `Bearer ${token.value}` },
      });
      return response.error === null && typeof response.data === 'object' && response.data !== null &&
        'status' in response.data && response.data.status === 'revoked'
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: response.error?.name === 'FunctionsFetchError' ? 'offline' : 'unexpected' } };
    } catch { return { ok: false, error: { code: 'offline' } }; }
  };

  readonly logoutSession: LogoutOperations['logoutSession'] = async (intent, saveCredential) => {
    const gateway = this.gateway(intent, saveCredential);
    if (gateway === undefined) return { ok: false, error: { code: 'unexpected' } };
    const restored = await gateway.restoreSession();
    if (!restored.ok) return restored;
    if (restored.value.kind === 'cached') return { ok: false, error: { code: 'offline' } };
    // A crash after successful Auth logout may leave authPending with an already
    // expired refresh credential. Installation revocation was durably recorded.
    return restored.value.kind === 'signedOut'
      ? { ok: true, value: undefined }
      : gateway.logout();
  };

  private gateway(
    intent: LogoutIntent,
    saveCredential: Parameters<LogoutOperations['logoutSession']>[1],
  ): SupabaseAuthGateway | undefined {
    const auth = this.makeAuth();
    if (auth === undefined) return undefined;
    return new SupabaseAuthGateway(auth, {
      load: async () => ({ ok: true, value: intent.credential }),
      save: saveCredential,
      // Only the durable workflow clears its marker after local wipe/rotation.
      // Auth expiry or successful signOut must not remove crash-recovery intent.
      clear: async (): Promise<AuthResult<void>> => ({ ok: true, value: undefined }),
    }, () => '', this.nowMilliseconds);
  }
}
