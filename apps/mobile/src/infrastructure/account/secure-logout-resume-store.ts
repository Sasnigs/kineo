import * as SecureStore from 'expo-secure-store';

import type { LogoutIntent, LogoutResumeStore } from '../../application/account/kineo-logout-workflow';
import type { AuthResult } from '../../core/account/auth-module';
import type { SecureStorePort } from './secure-refresh-token-vault';

const logoutResumeKey = 'logout-resume-v1';
const logoutResumeService = 'com.kineo.logout-resume';
const logoutFormatVersion = 1;
const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const options = Object.freeze({
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: logoutResumeService,
});

export class SecureLogoutResumeStore implements LogoutResumeStore {
  constructor(private readonly store: SecureStorePort = SecureStore) {}

  async load(): Promise<AuthResult<LogoutIntent | undefined>> {
    try {
      const source = await this.store.getItemAsync(logoutResumeKey, options);
      if (source === null) return { ok: true, value: undefined };
      const value: unknown = JSON.parse(source);
      return isRecord(value) && value.version === logoutFormatVersion && isIntent(value.intent)
        ? { ok: true, value: value.intent } : failure();
    } catch { return failure(); }
  }

  async save(intent: LogoutIntent): Promise<AuthResult<void>> {
    if (!isIntent(intent)) return failure();
    try {
      await this.store.setItemAsync(logoutResumeKey, JSON.stringify({ version: logoutFormatVersion, intent }), options);
      return { ok: true, value: undefined };
    } catch { return failure(); }
  }

  async clear(): Promise<AuthResult<void>> {
    try {
      await this.store.deleteItemAsync(logoutResumeKey, options);
      return { ok: true, value: undefined };
    } catch { return failure(); }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntent(value: unknown): value is LogoutIntent {
  if (!isRecord(value) || typeof value.installationId !== 'string' || !uuidShape.test(value.installationId) ||
      typeof value.discardPendingChanges !== 'boolean' || typeof value.localWiped !== 'boolean' ||
      (value.phase !== 'installationPending' && value.phase !== 'authPending' && value.phase !== 'localPending') ||
      !isRecord(value.credential) || typeof value.credential.refreshToken !== 'string' ||
      value.credential.refreshToken.length === 0) return false;
  const identity = value.credential.identity;
  return identity === undefined || (isRecord(identity) && typeof identity.accountId === 'string' &&
    uuidShape.test(identity.accountId) &&
    (identity.provider === 'apple' || identity.provider === 'google' || identity.provider === 'email'));
}

function failure<Value>(): AuthResult<Value> {
  return { ok: false, error: { code: 'secureStorageUnavailable' } };
}
