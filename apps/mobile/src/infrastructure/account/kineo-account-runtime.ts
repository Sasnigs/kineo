import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import { KineoAccountPrivacyModule, resumeStoredDeletion } from '../../application/account/kineo-account-privacy-module';
import { KineoAccountSession } from '../../application/account/kineo-account-session';
import { KineoAuthModule, type IdentityTokenProvider } from '../../application/account/kineo-auth-module';
import { KineoLogoutWorkflow, type LogoutOperations, type LogoutRecoveryState } from '../../application/account/kineo-logout-workflow';
import { KineoSyncModule } from '../../application/account/kineo-sync-module';
import type {
  AuthModule,
  AuthProvider,
  AuthResult,
} from '../../core/account/auth-module';
import type { SyncResult } from '../../core/account/sync-module';
import type { EmailCredentials } from '../../core/account/account-domain';
import type { DeletionStatus, PersonalDataExportSharer, PrivacyResult } from '../../core/account/account-privacy-module';
import { expoReminderScheduler } from '../reminders/expo-reminder-scheduler';
import type { OpenedKineoLocalRuntime } from '../persistence/open-protected-kineo-store';
import {
  DevelopmentAuthGateway,
  DevelopmentIdentityProvider,
  DevelopmentPrivacyTransport,
  DevelopmentSyncTransport,
} from './development-account-services';
import { InstallationIdentity } from './installation-identity';
import { ExpoPersonalDataExportSharer } from './expo-personal-data-export-sharer';
import { KineoLocalPrivacyStore } from './local-privacy-store';
import {
  AppleIdentityTokenProvider,
  GoogleIdentityTokenProvider,
} from './native-identity-providers';
import { SecureDeletionResumeStore } from './secure-deletion-resume-store';
import { SecureRefreshTokenVault } from './secure-refresh-token-vault';
import { SecureLogoutResumeStore } from './secure-logout-resume-store';
import { SupabaseLogoutRecovery } from './supabase-logout-recovery';
import { SupabaseAccountPrivacyTransport } from './supabase-account-privacy-transport';
import type { SupabaseAuthPort } from './supabase-auth-gateway';
import { SupabaseAuthGateway } from './supabase-auth-gateway';
import { AuthenticatedFunctions } from './authenticated-functions';
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
  exportSharer: PersonalDataExportSharer;
  usesDevelopmentServices: boolean;
  resumePendingDeletion(): Promise<PrivacyResult<DeletionStatus | undefined>>;
  resumePendingLogout(): Promise<AuthResult<LogoutRecoveryState>>;
  reauthenticatePendingLogout(method:
    | Readonly<{ kind: 'email'; credentials: EmailCredentials }>
    | Readonly<{ kind: 'apple' | 'google' }>
  ): Promise<AuthResult<LogoutRecoveryState>>;
  connect(
    accountId: string,
    provider: AuthProvider,
  ): Promise<AccountRuntimeResult<KineoAccountSession>>;
}>;

class RuntimeLogoutOperations implements LogoutOperations {
  private session?: KineoAccountSession;

  constructor(
    private readonly local: OpenedKineoLocalRuntime,
    private readonly identity: InstallationIdentity,
    private readonly vault: SecureRefreshTokenVault,
    private readonly gateway: SupabaseAuthGateway | DevelopmentAuthGateway,
    private readonly remote?: SupabaseLogoutRecovery,
  ) {}

  attach(session: KineoAccountSession): void {
    this.session = session;
  }

  async flushPendingMutations(): Promise<AuthResult<void>> {
    const session = this.session;
    if (session === undefined) return { ok: true, value: undefined };
    const pending = await session.outbox.pendingMutations();
    if (!pending.ok) return syncToAuth(pending);
    if (pending.value.length === 0) return { ok: true, value: undefined };
    const synchronized = await session.sync.synchronize(pending.value);
    return syncToAuth(synchronized, () => undefined);
  }

  async capture(): ReturnType<LogoutOperations['capture']> {
    if (this.gateway instanceof SupabaseAuthGateway) await this.gateway.suspendForLogout();
    const installation = await this.identity.getOrCreate();
    if (!installation.ok) return { ok: false, error: { code: 'secureStorageUnavailable' } };
    const credential = await this.vault.load();
    if (!credential.ok) return credential;
    return credential.value === undefined
      ? { ok: false, error: { code: 'sessionExpired' } }
      : { ok: true, value: { installationId: installation.value, credential: credential.value } };
  }

  revokeInstallation: LogoutOperations['revokeInstallation'] = (intent, saveCredential) =>
    this.remote?.revokeInstallation(intent, saveCredential) ?? Promise.resolve({ ok: true, value: undefined });

  logoutSession: LogoutOperations['logoutSession'] = (intent, saveCredential) =>
    this.remote?.logoutSession(intent, saveCredential) ?? Promise.resolve({ ok: true, value: undefined });

  async wipeLocalAccount(): Promise<AuthResult<void>> {
    const cancelled = await expoReminderScheduler.cancelAll();
    if (!cancelled.ok) return { ok: false, error: { code: 'unexpected' } };
    const wiped = await this.local.store.deleteAllData();
    if (!wiped.ok) return { ok: false, error: { code: 'unexpected' } };
    const cleared = await this.vault.clear();
    if (cleared.ok) this.session = undefined;
    return cleared;
  }

  async rotateInstallation(previousInstallationId: string): Promise<AuthResult<void>> {
    const rotated = await this.identity.rotateAfterLogout(previousInstallationId);
    return rotated.ok ? { ok: true, value: undefined }
      : { ok: false, error: { code: 'secureStorageUnavailable' } };
  }
}

export async function createKineoAccountRuntime(
  local: OpenedKineoLocalRuntime,
): Promise<AccountRuntimeResult<KineoAccountRuntime>> {
  const installationIdentity = new InstallationIdentity();
  const installation = await installationIdentity.getOrCreate();
  if (!installation.ok) {
    return { ok: false, error: { code: 'localPersistence' } };
  }
  const configured = createConfiguredSupabaseClient();
  const internalTestMode =
    process.env.EXPO_PUBLIC_KINEO_ACCOUNT_MODE === 'internal-test';
  const development = !configured.ok && (__DEV__ || internalTestMode);
  if (!configured.ok && !development) {
    return { ok: false, error: { code: 'configurationMissing' } };
  }
  const client = configured.ok ? configured.value : undefined;
  const vault = new SecureRefreshTokenVault();
  const logoutStore = new SecureLogoutResumeStore();
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
        () => {
          const isolated = createConfiguredSupabaseClient();
          return isolated.ok
            ? isolated.value.auth as unknown as SupabaseAuthPort
            : undefined;
        },
      );
  // Do not let function requests call getSession on the Auth client's
  // expiring in-memory session and rotate outside our protected vault.
  const dataClient = development ? undefined : createConfiguredSupabaseClient();
  if (dataClient !== undefined && !dataClient.ok) {
    return { ok: false, error: { code: 'configurationMissing' } };
  }
  const functions = gateway instanceof SupabaseAuthGateway && dataClient?.ok
    ? new AuthenticatedFunctions(dataClient.value.functions, async () => {
        const pending = await logoutStore.load();
        if (!pending.ok) return pending;
        return pending.value === undefined ? gateway.validAccessToken()
          : { ok: false, error: { code: 'sessionExpired' } };
      })
    : undefined;
  const remoteLogout = dataClient?.ok ? new SupabaseLogoutRecovery(() => {
    const isolated = createConfiguredSupabaseClient();
    return isolated.ok ? isolated.value.auth as unknown as SupabaseAuthPort : undefined;
  }, dataClient.value.functions, Date.now) : undefined;
  const logoutOperations = new RuntimeLogoutOperations(local, installationIdentity, vault, gateway, remoteLogout);
  const logoutWorkflow = new KineoLogoutWorkflow(logoutStore, logoutOperations);
  const resumePendingLogout = async (): Promise<AuthResult<LogoutRecoveryState>> => {
    const result = await logoutWorkflow.resumePendingLogout();
    if (result.ok && result.value.kind === 'complete' && gateway instanceof SupabaseAuthGateway) {
      gateway.resumeAfterLogout();
    }
    return result;
  };
  const appleIdentity: IdentityTokenProvider = development ? identity : new AppleIdentityTokenProvider();
  const googleIdentity: IdentityTokenProvider = development
      ? identity
      : new GoogleIdentityTokenProvider({
          webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
          iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
        });
  const auth = new KineoAuthModule(
    gateway,
    appleIdentity,
    googleIdentity,
    {
      resumePendingLogout,
      async logout(policy) {
        const result = await logoutWorkflow.logout(policy);
        if (gateway instanceof SupabaseAuthGateway) {
          const marker = await logoutStore.load();
          if (marker.ok && marker.value === undefined) gateway.resumeAfterLogout();
        }
        return result;
      },
    },
  );
  const resumeStore = new SecureDeletionResumeStore();
  const wipePrivateDevice = async (): Promise<PrivacyResult<void>> => {
    const cancelled = await expoReminderScheduler.cancelAll();
    if (!cancelled.ok) return { ok: false, error: { code: 'localWipeFailed' } };
    const wiped = await local.store.deleteAllData();
    if (!wiped.ok) return { ok: false, error: { code: 'localWipeFailed' } };
    const cleared = await vault.clear();
    return cleared.ok ? { ok: true, value: undefined } : { ok: false, error: { code: 'localWipeFailed' } };
  };

  return {
    ok: true,
    value: {
      auth,
      exportSharer: new ExpoPersonalDataExportSharer(),
      usesDevelopmentServices: development,
      resumePendingLogout,
      async reauthenticatePendingLogout(method) {
        const recovered = await logoutWorkflow.reauthenticatePendingLogout(async (intent) => {
          if (remoteLogout === undefined) return { ok: false, error: { code: 'unexpected' } };
          if (method.kind === 'email') return remoteLogout.reauthenticate(intent, method);
          const acquired = await (method.kind === 'apple' ? appleIdentity : googleIdentity).acquireIdentityToken();
          return acquired.ok ? remoteLogout.reauthenticate(intent, {
            kind: 'identityToken', provider: method.kind,
            token: acquired.value.token, nonce: acquired.value.nonce,
          }) : acquired;
        });
        if (recovered.ok && recovered.value.kind === 'complete' && gateway instanceof SupabaseAuthGateway) {
          gateway.resumeAfterLogout();
        }
        return recovered;
      },
      resumePendingDeletion() {
        const transport = development
          ? { deletionStatus: async (credential: { resumeToken: string }): Promise<PrivacyResult<DeletionStatus>> =>
              credential.resumeToken === 'development-resume-token'
                ? { ok: true, value: { kind: 'complete' } }
                : { ok: false, error: { code: 'workflowFailed' } } }
          : new SupabaseAccountPrivacyTransport(functions as SupabaseFunctionsPort,
              installation.value, async () => undefined, randomUUID);
        return resumeStoredDeletion(transport, resumeStore, wipePrivateDevice);
      },
      async connect(accountId, provider) {
        const logout = await resumePendingLogout();
        if (!logout.ok || logout.value.kind === 'pending') {
          return { ok: false, error: { code: 'localPersistence' } };
        }
        const installation = await installationIdentity.getOrCreate();
        if (!installation.ok) return { ok: false, error: { code: 'localPersistence' } };
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
          resumeStore,
          new KineoLocalPrivacyStore(wipePrivateDevice, repository),
          Date.now,
        );
        const session = new KineoAccountSession(
          accountId,
          installation.value,
          provider,
          sync,
          repository,
          privacy,
          randomUUID,
          Date.now,
        );
        logoutOperations.attach(session);
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
