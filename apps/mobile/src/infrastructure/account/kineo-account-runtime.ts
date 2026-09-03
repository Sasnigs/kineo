import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import { KineoAccountPrivacyModule } from '../../application/account/kineo-account-privacy-module';
import { KineoAccountSession } from '../../application/account/kineo-account-session';
import {
  KineoAuthModule,
  type LogoutCoordinator,
} from '../../application/account/kineo-auth-module';
import { KineoSyncModule } from '../../application/account/kineo-sync-module';
import type {
  AuthModule,
  AuthResult,
} from '../../core/account/auth-module';
import type { SyncResult } from '../../core/account/sync-module';
import type { OpenedKineoLocalRuntime } from '../persistence/open-protected-kineo-store';
import {
  DevelopmentAuthGateway,
  DevelopmentIdentityProvider,
  DevelopmentPrivacyTransport,
  DevelopmentSyncTransport,
} from './development-account-services';
import { InstallationIdentity } from './installation-identity';
import { KineoLocalPrivacyStore } from './local-privacy-store';
import {
  AppleIdentityTokenProvider,
  GoogleIdentityTokenProvider,
} from './native-identity-providers';
import { SecureDeletionResumeStore } from './secure-deletion-resume-store';
import { SecureRefreshTokenVault } from './secure-refresh-token-vault';
import { SupabaseAccountPrivacyTransport } from './supabase-account-privacy-transport';
import type { SupabaseAuthPort } from './supabase-auth-gateway';
import { SupabaseAuthGateway } from './supabase-auth-gateway';
import { createConfiguredSupabaseClient } from './supabase-client';
import {
  SupabaseSyncTransport,
  type SupabaseFunctionsPort,
} from './supabase-sync-transport';

export type AccountRuntimeError =
  | Readonly<{ code: 'configurationMissing' }>
  | Readonly<{ code: 'localPersistence' }>;

export type AccountRuntimeResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: AccountRuntimeError }>;

export type KineoAccountRuntime = Readonly<{
  auth: AuthModule;
  usesDevelopmentServices: boolean;
  connect(accountId: string): Promise<AccountRuntimeResult<KineoAccountSession>>;
}>;

class RuntimeLogoutCoordinator implements LogoutCoordinator {
  private session?: KineoAccountSession;

  constructor(
    private readonly local: OpenedKineoLocalRuntime,
    private readonly installationId: string,
    private readonly functions?: SupabaseFunctionsPort,
  ) {}

  attach(session: KineoAccountSession): void {
    this.session = session;
  }

  async hasPendingMutations(): Promise<AuthResult<boolean>> {
    const result = await this.session?.outbox.pendingMutations();
    return result === undefined
      ? { ok: true, value: false }
      : syncToAuth(result, (mutations) => mutations.length > 0);
  }

  async flushPendingMutations(): Promise<AuthResult<void>> {
    const session = this.session;
    if (session === undefined) return { ok: true, value: undefined };
    const pending = await session.outbox.pendingMutations();
    if (!pending.ok) return syncToAuth(pending);
    const synchronized = await session.sync.synchronize(pending.value);
    return syncToAuth(synchronized, () => undefined);
  }

  async discardPendingMutations(): Promise<AuthResult<void>> {
    const result = await this.session?.outbox.discardPendingMutations();
    return result === undefined
      ? { ok: true, value: undefined }
      : syncToAuth(result);
  }

  async revokeInstallation(): Promise<AuthResult<void>> {
    if (this.functions === undefined) return { ok: true, value: undefined };
    try {
      const result = await this.functions.invoke('revoke-installation', {
        body: { installationId: this.installationId },
      });
      return result.error === null
        ? { ok: true, value: undefined }
        : { ok: false, error: { code: 'unexpected' } };
    } catch {
      return { ok: false, error: { code: 'offline' } };
    }
  }

  async wipeLocalAccount(): Promise<AuthResult<void>> {
    const wiped = await this.local.store.deleteAllData();
    return wiped.ok
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'unexpected' } };
  }
}

export async function createKineoAccountRuntime(
  local: OpenedKineoLocalRuntime,
): Promise<AccountRuntimeResult<KineoAccountRuntime>> {
  const installation = await new InstallationIdentity().getOrCreate();
  if (!installation.ok) {
    return { ok: false, error: { code: 'localPersistence' } };
  }
  const configured = createConfiguredSupabaseClient();
  const development = !configured.ok && __DEV__;
  if (!configured.ok && !development) {
    return { ok: false, error: { code: 'configurationMissing' } };
  }
  const client = configured.ok ? configured.value : undefined;
  const functions = client?.functions as SupabaseFunctionsPort | undefined;
  const coordinator = new RuntimeLogoutCoordinator(
    local,
    installation.value,
    functions,
  );
  const vault = new SecureRefreshTokenVault();
  const identity = new DevelopmentIdentityProvider();
  const gateway = development
    ? new DevelopmentAuthGateway(vault, Date.now)
    : new SupabaseAuthGateway(
        client?.auth as unknown as SupabaseAuthPort,
        vault,
        randomUUID,
        Date.now,
        'kineo://auth/callback',
        'kineo://auth/reset',
      );
  const auth = new KineoAuthModule(
    gateway,
    development ? identity : new AppleIdentityTokenProvider(),
    development
      ? identity
      : new GoogleIdentityTokenProvider({
          webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
          iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        }),
    coordinator,
  );

  return {
    ok: true,
    value: {
      auth,
      usesDevelopmentServices: development,
      async connect(accountId) {
        const repository = local.syncRepository(
          accountId,
          installation.value,
        );
        const initialized = await repository.initialize(Date.now());
        if (!initialized.ok) {
          return { ok: false, error: { code: 'localPersistence' } };
        }
        const transport = development
          ? new DevelopmentSyncTransport(repository, accountId)
          : new SupabaseSyncTransport(
              functions as SupabaseFunctionsPort,
              {
                installationId: installation.value,
                appVersion: Constants.expoConfig?.version ?? 'unknown',
                platformVersion: String(Platform.Version),
              },
            );
        const sync = new KineoSyncModule(
          accountId,
          installation.value,
          transport,
          repository,
        );
        const privacyTransport = development
          ? new DevelopmentPrivacyTransport(repository)
          : new SupabaseAccountPrivacyTransport(
              functions as SupabaseFunctionsPort,
              installation.value,
              async () => {
                const account = await repository.loadAccount();
                return account.ok ? account.value?.historyEpoch : undefined;
              },
              randomUUID,
            );
        const privacy = new KineoAccountPrivacyModule(
          privacyTransport,
          new SecureDeletionResumeStore(),
          new KineoLocalPrivacyStore(local.store, repository),
          Date.now,
        );
        const session = new KineoAccountSession(
          accountId,
          installation.value,
          sync,
          repository,
          privacy,
          randomUUID,
          Date.now,
        );
        coordinator.attach(session);
        return { ok: true, value: session };
      },
    },
  };
}

function syncToAuth<Input, Output = void>(
  result: SyncResult<Input>,
  transform: (value: Input) => Output = () => undefined as Output,
): AuthResult<Output> {
  if (result.ok) return { ok: true, value: transform(result.value) };
  switch (result.error.code) {
    case 'offline':
      return { ok: false, error: { code: 'offline' } };
    case 'authenticationRequired':
      return { ok: false, error: { code: 'sessionExpired' } };
    case 'installationRevoked':
      return { ok: false, error: { code: 'sessionExpired' } };
    default:
      return { ok: false, error: { code: 'unexpected' } };
  }
}
