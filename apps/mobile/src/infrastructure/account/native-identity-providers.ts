import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleSignin,
  isCancelledResponse,
} from '@react-native-google-signin/google-signin';

import type { IdentityTokenProvider } from '../../application/account/kineo-auth-module';
import type { AuthResult } from '../../core/account/auth-module';

type IdentityToken = Readonly<{ token: string; nonce?: string }>;

function isErrorCode(
  error: unknown,
  expected: string,
): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === expected;
}

export class AppleIdentityTokenProvider implements IdentityTokenProvider {
  async acquireIdentityToken(): Promise<AuthResult<IdentityToken>> {
    try {
      if (!(await AppleAuthentication.isAvailableAsync())) {
        return {
          ok: false,
          error: { code: 'providerUnavailable', provider: 'apple' },
        };
      }
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        nonce: hashedNonce,
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      });
      if (credential.identityToken === null) {
        return { ok: false, error: { code: 'invalidCredentials' } };
      }
      return {
        ok: true,
        value: {
          token: credential.identityToken,
          nonce: rawNonce,
        },
      };
    } catch (error) {
      return isErrorCode(error, 'ERR_REQUEST_CANCELED')
        ? { ok: false, error: { code: 'cancelled' } }
        : {
            ok: false,
            error: { code: 'providerUnavailable', provider: 'apple' },
          };
    }
  }
}

export type GoogleIdentityConfiguration = Readonly<{
  webClientId?: string;
  iosClientId?: string;
}>;

export class GoogleIdentityTokenProvider implements IdentityTokenProvider {
  private configured = false;

  constructor(private readonly configuration: GoogleIdentityConfiguration) {}

  async acquireIdentityToken(): Promise<AuthResult<IdentityToken>> {
    const webClientId = this.configuration.webClientId;
    const iosClientId = this.configuration.iosClientId;
    if (
      webClientId === undefined ||
      webClientId.length === 0 ||
      iosClientId === undefined ||
      iosClientId.length === 0
    ) {
      return {
        ok: false,
        error: { code: 'providerUnavailable', provider: 'google' },
      };
    }
    try {
      if (!this.configured) {
        GoogleSignin.configure({
          webClientId,
          iosClientId,
          offlineAccess: false,
        });
        this.configured = true;
      }
      const response = await GoogleSignin.signIn();
      if (isCancelledResponse(response)) {
        return { ok: false, error: { code: 'cancelled' } };
      }
      const token = response.data.idToken;
      return token === null
        ? { ok: false, error: { code: 'invalidCredentials' } }
        : { ok: true, value: { token } };
    } catch {
      return {
        ok: false,
        error: { code: 'providerUnavailable', provider: 'google' },
      };
    }
  }
}
