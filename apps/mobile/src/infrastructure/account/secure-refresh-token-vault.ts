import * as SecureStore from 'expo-secure-store';

import type { AuthProvider, AuthResult } from '../../core/account/auth-module';

export const refreshTokenKey = 'kineo.refresh-token';
export const refreshTokenKeychainService = 'app.kineo.auth';

type SecureStoreOptions = Readonly<{
  keychainAccessible: number;
  keychainService: string;
}>;

export interface SecureStorePort {
  getItemAsync(
    key: string,
    options: SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options: SecureStoreOptions,
  ): Promise<void>;
  deleteItemAsync(
    key: string,
    options: SecureStoreOptions,
  ): Promise<void>;
}

export type StoredRefreshCredential = Readonly<{
  refreshToken: string;
  // Legacy development credentials can refresh online but cannot identify an
  // account offline. New credentials always include the verified identity.
  identity?: Readonly<{ accountId: string; provider: AuthProvider }>;
}>;
const credentialFormatVersion = 1;
const accountIdentifierShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface RefreshTokenVault {
  load(): Promise<AuthResult<StoredRefreshCredential | undefined>>;
  save(credential: StoredRefreshCredential): Promise<AuthResult<void>>;
  clear(): Promise<AuthResult<void>>;
}

export class SecureRefreshTokenVault implements RefreshTokenVault {
  private readonly options: SecureStoreOptions;

  constructor(
    private readonly secureStore: SecureStorePort = SecureStore,
    keychainAccessible: number = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  ) {
    this.options = {
      keychainAccessible,
      keychainService: refreshTokenKeychainService,
    };
  }

  async load(): Promise<AuthResult<StoredRefreshCredential | undefined>> {
    try {
      const value = await this.secureStore.getItemAsync(
        refreshTokenKey,
        this.options,
      );
      if (value === null) return { ok: true, value: undefined };
      if (!value.startsWith('{')) {
        return value.length > 0
          ? { ok: true, value: { refreshToken: value } }
          : { ok: false, error: { code: 'secureStorageUnavailable' } };
      }
      const decoded: unknown = JSON.parse(value);
      return isCredentialEnvelope(decoded)
        ? { ok: true, value: { refreshToken: decoded.refreshToken,
            ...(decoded.identity === undefined ? {} : { identity: decoded.identity }) } }
        : { ok: false, error: { code: 'secureStorageUnavailable' } };
    } catch {
      return {
        ok: false,
        error: { code: 'secureStorageUnavailable' },
      };
    }
  }

  async save(credential: StoredRefreshCredential): Promise<AuthResult<void>> {
    const envelope = { ...credential, version: credentialFormatVersion };
    if (!isCredentialEnvelope(envelope)) {
      return { ok: false, error: { code: 'invalidCredentials' } };
    }
    try {
      await this.secureStore.setItemAsync(
        refreshTokenKey,
        JSON.stringify(envelope),
        this.options,
      );
      return { ok: true, value: undefined };
    } catch {
      return {
        ok: false,
        error: { code: 'secureStorageUnavailable' },
      };
    }
  }

  async clear(): Promise<AuthResult<void>> {
    try {
      await this.secureStore.deleteItemAsync(
        refreshTokenKey,
        this.options,
      );
      return { ok: true, value: undefined };
    } catch {
      return {
        ok: false,
        error: { code: 'secureStorageUnavailable' },
      };
    }
  }
}

function isCredentialEnvelope(value: unknown): value is StoredRefreshCredential & { version: number } {
  if (typeof value !== 'object' || value === null ||
      !('version' in value) || value.version !== credentialFormatVersion ||
      !('refreshToken' in value) || typeof value.refreshToken !== 'string' || value.refreshToken.length === 0) {
    return false;
  }
  if (!('identity' in value) || value.identity === undefined) return true;
  const identity = value.identity;
  return typeof identity === 'object' && identity !== null &&
    'accountId' in identity && typeof identity.accountId === 'string' && accountIdentifierShape.test(identity.accountId) &&
    'provider' in identity && (identity.provider === 'apple' || identity.provider === 'google' || identity.provider === 'email');
}
