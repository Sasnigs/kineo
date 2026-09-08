import type { AuthError, AuthProvider, AuthResult, LogoutPolicy } from '../../core/account/auth-module';

export type LogoutCredential = Readonly<{
  refreshToken: string;
  identity?: Readonly<{ accountId: string; provider: AuthProvider }>;
}>;

export type LogoutIntent = Readonly<{
  installationId: string;
  credential: LogoutCredential;
  discardPendingChanges: boolean;
  localWiped: boolean;
  phase: 'installationPending' | 'authPending' | 'localPending';
}>;

export type LogoutRecoveryState =
  | Readonly<{ kind: 'none' | 'complete' }>
  | Readonly<{ kind: 'pending'; localWiped: boolean; canReauthenticate?: boolean; error: AuthError }>;

export interface LogoutResumeStore {
  load(): Promise<AuthResult<LogoutIntent | undefined>>;
  save(intent: LogoutIntent): Promise<AuthResult<void>>;
  clear(): Promise<AuthResult<void>>;
}

type SaveCredential = (credential: LogoutCredential) => Promise<AuthResult<void>>;

export interface LogoutOperations {
  flushPendingMutations(): Promise<AuthResult<void>>;
  capture(): Promise<AuthResult<Pick<LogoutIntent, 'installationId' | 'credential'>>>;
  revokeInstallation(intent: LogoutIntent, saveCredential: SaveCredential): Promise<AuthResult<void>>;
  logoutSession(intent: LogoutIntent, saveCredential: SaveCredential): Promise<AuthResult<void>>;
  wipeLocalAccount(): Promise<AuthResult<void>>;
  rotateInstallation(previousInstallationId: string): Promise<AuthResult<void>>;
}

/** Recovery credentials never flow back through the ordinary authentication vault. */
export class KineoLogoutWorkflow {
  private inFlight?: Promise<AuthResult<LogoutRecoveryState>>;

  constructor(private readonly store: LogoutResumeStore, private readonly operations: LogoutOperations) {}

  async logout(policy: LogoutPolicy): Promise<AuthResult<void>> {
    const result = await this.run(async () => {
      const existing = await this.store.load();
      if (!existing.ok) return existing;
      if (existing.value !== undefined) return this.resume(existing.value);
      // No destructive step has started yet. A failed flush preserves both the
      // ordinary session and its outbox so the user may wait or choose discard.
      if (policy === 'waitForSync') {
        const flushed = await this.operations.flushPendingMutations();
        if (!flushed.ok) return flushed;
      }
      const captured = await this.operations.capture();
      if (!captured.ok) return captured;
      const intent: LogoutIntent = {
        ...captured.value,
        discardPendingChanges: policy === 'discardPendingChanges',
        localWiped: false,
        phase: 'installationPending',
      };
      const saved = await this.store.save(intent);
      return saved.ok ? this.resume(intent) : saved;
    });
    if (!result.ok) return result;
    if (result.value.kind === 'none') return this.logout(policy);
    return result.value.kind === 'pending'
      ? { ok: false, error: result.value.error }
      : { ok: true, value: undefined };
  }

  resumePendingLogout(): Promise<AuthResult<LogoutRecoveryState>> {
    return this.run(async () => {
      const loaded = await this.store.load();
      if (!loaded.ok) return loaded;
      return loaded.value === undefined
        ? { ok: true, value: { kind: 'none' } }
        : this.resume(loaded.value);
    });
  }

  reauthenticatePendingLogout(
    authenticate: (intent: LogoutIntent) => Promise<AuthResult<LogoutCredential>>,
  ): Promise<AuthResult<LogoutRecoveryState>> {
    return this.run(async () => {
      const loaded = await this.store.load();
      if (!loaded.ok) return loaded;
      const intent = loaded.value;
      if (intent === undefined || intent.credential.identity === undefined) {
        return { ok: false, error: { code: 'reauthenticationRequired' } };
      }
      if (intent.phase !== 'installationPending') return this.resume(intent);
      const authenticated = await authenticate(intent);
      if (!authenticated.ok) return authenticated;
      if (authenticated.value.identity?.accountId !== intent.credential.identity.accountId) {
        return { ok: false, error: { code: 'reauthenticationRequired' } };
      }
      const updated = { ...intent, credential: authenticated.value };
      const saved = await this.store.save(updated);
      return saved.ok ? this.resume(updated) : saved;
    });
  }

  private run(operation: () => Promise<AuthResult<LogoutRecoveryState>>): Promise<AuthResult<LogoutRecoveryState>> {
    this.inFlight ??= operation().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async resume(initial: LogoutIntent): Promise<AuthResult<LogoutRecoveryState>> {
    let intent = initial;
    const pending = (error: AuthError): AuthResult<LogoutRecoveryState> => ({
      ok: true, value: { kind: 'pending', localWiped: intent.localWiped,
        canReauthenticate: intent.credential.identity !== undefined && intent.phase === 'installationPending', error },
    });
    const save = async (next: LogoutIntent): Promise<AuthResult<void>> => {
      const saved = await this.store.save(next);
      if (saved.ok) intent = next;
      return saved;
    };
    const saveCredential: SaveCredential = (credential) => save({ ...intent, credential });
    const wipe = async (): Promise<AuthResult<void>> => {
      const wiped = await this.operations.wipeLocalAccount();
      return wiped.ok ? save({ ...intent, localWiped: true }) : wiped;
    };
    if (intent.discardPendingChanges && !intent.localWiped) {
      const wiped = await wipe();
      if (!wiped.ok) return pending(wiped.error);
    }
    if (intent.phase === 'installationPending') {
      const revoked = await this.operations.revokeInstallation(intent, saveCredential);
      if (!revoked.ok) return pending(revoked.error);
      const saved = await save({ ...intent, phase: 'authPending' });
      if (!saved.ok) return pending(saved.error);
    }
    if (intent.phase === 'authPending') {
      const loggedOut = await this.operations.logoutSession(intent, saveCredential);
      if (!loggedOut.ok) return pending(loggedOut.error);
      const saved = await save({ ...intent, phase: 'localPending' });
      if (!saved.ok) return pending(saved.error);
    }
    if (!intent.localWiped) {
      const wiped = await wipe();
      if (!wiped.ok) return pending(wiped.error);
    }
    const rotated = await this.operations.rotateInstallation(intent.installationId);
    if (!rotated.ok) return pending(rotated.error);
    const cleared = await this.store.clear();
    return cleared.ok ? { ok: true, value: { kind: 'complete' } } : pending(cleared.error);
  }
}
