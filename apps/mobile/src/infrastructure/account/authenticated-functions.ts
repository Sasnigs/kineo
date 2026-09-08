import type { AuthResult } from '../../core/account/auth-module';
import type { SupabaseFunctionsPort } from './supabase-sync-transport';

const unauthorizedStatus = 401;

/** The underlying client must have no Auth session of its own: this gateway
 * alone rotates refresh credentials and persists them before sending work. */
export class AuthenticatedFunctions implements SupabaseFunctionsPort {
  constructor(
    private readonly functions: SupabaseFunctionsPort,
    private readonly accessToken: () => Promise<AuthResult<string>>,
  ) {}

  async invoke(functionName: string, options: Readonly<{ body: object }>) {
    // Deletion uses a narrowly scoped recovery capability after Auth is removed.
    if (functionName === 'deletion-status') return this.functions.invoke(functionName, options);
    const token = await this.accessToken();
    if (!token.ok) {
      return {
        data: null,
        error: token.error.code === 'offline'
          ? { name: 'FunctionsFetchError' }
          : token.error.code === 'sessionExpired' || token.error.code === 'invalidCredentials'
            ? { context: { status: unauthorizedStatus } }
            : { name: 'CredentialUnavailable' },
      };
    }
    return this.functions.invoke(functionName, {
      ...options, headers: { Authorization: `Bearer ${token.value}` },
    });
  }
}
