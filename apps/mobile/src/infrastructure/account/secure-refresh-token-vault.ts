import * as SecureStore from 'expo-secure-store';

import type { AuthResult } from '../../core/account/auth-module';

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

export interface RefreshTokenVault {
  load(): Promise<AuthResult<string | undefined>>;
  save(refreshToken: string): Promise<AuthResult<void>>;
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

  async load(): Promise<AuthResult<string | undefined>> {
    try {
      const value = await this.secureStore.getItemAsync(
        refreshTokenKey,
        this.options,
      );
      return {
        ok: true,
        value: value === null ? undefined : value,
      };
    } catch {
      return {
        ok: false,
        error: { code: 'secureStorageUnavailable' },
      };
    }
  }

  async save(refreshToken: string): Promise<AuthResult<void>> {
    if (refreshToken.length === 0) {
      return { ok: false, error: { code: 'invalidCredentials' } };
    }
    try {
      await this.secureStore.setItemAsync(
        refreshTokenKey,
        refreshToken,
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
