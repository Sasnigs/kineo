import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { OpenedKineoLocalRuntime } from '../persistence/open-protected-kineo-store';
import { expoReminderScheduler } from '../reminders/expo-reminder-scheduler';
import { createKineoAccountRuntime } from './kineo-account-runtime';
import { InstallationIdentity } from './installation-identity';
import { SecureRefreshTokenVault } from './secure-refresh-token-vault';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn() }, isCancelledResponse: () => false,
}));

jest.mock('./supabase-client', () => ({
  createConfiguredSupabaseClient: () => ({ ok: false, error: { code: 'configurationMissing' } }),
}));
jest.mock('../reminders/expo-reminder-scheduler', () => ({
  expoReminderScheduler: { cancelAll: jest.fn(async () => ({ ok: true, value: undefined })) },
}));

describe('Account runtime logout and relogin', () => {
  beforeEach(() => {
    jest.spyOn(Crypto, 'randomUUID')
      .mockReturnValueOnce('20000000-0000-4000-8000-000000000001')
      .mockReturnValue('20000000-0000-4000-8000-000000000002');
    const protectedValues = new Map<string, string>();
    jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async (key, options) =>
      protectedValues.get(`${options?.keychainService}:${key}`) ?? null);
    jest.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (key, value, options) => {
      protectedValues.set(`${options?.keychainService}:${key}`, value);
    });
    jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation(async (key, options) => {
      protectedValues.delete(`${options?.keychainService}:${key}`);
    });
    jest.clearAllMocks();
  });

  it('clears reminders and private storage, then relogin uses a fresh installation', async () => {
    const deleteAllData = jest.fn(async () => ({ ok: true as const, value: undefined }));
    const local = { store: { deleteAllData } } as unknown as OpenedKineoLocalRuntime;
    const initial = await createKineoAccountRuntime(local);
    if (!initial.ok) throw new Error('Runtime did not initialize.');
    const initialIdentity = await new InstallationIdentity().getOrCreate();
    expect((await initial.value.auth.signInWithEmail({ email: 'person@example.com', password: 'correct horse battery staple' })).ok).toBe(true);
    expect(await initial.value.auth.logout('discardPendingChanges')).toEqual({ ok: true, value: undefined });
    expect(deleteAllData).toHaveBeenCalledTimes(1);
    expect(expoReminderScheduler.cancelAll).toHaveBeenCalledTimes(1);
    expect(await new SecureRefreshTokenVault().load()).toEqual({ ok: true, value: undefined });
    expect(await initial.value.resumePendingLogout()).toEqual({ ok: true, value: { kind: 'none' } });

    const reopened = await createKineoAccountRuntime(local);
    if (!reopened.ok) throw new Error('Runtime did not reopen.');
    expect(await reopened.value.auth.restoreSession()).toEqual({ ok: true, value: { kind: 'signedOut' } });
    const newIdentity = await new InstallationIdentity().getOrCreate();
    expect(newIdentity.ok).toBe(true);
    expect(newIdentity).not.toEqual(initialIdentity);
    expect((await reopened.value.auth.signInWithEmail({ email: 'person@example.com', password: 'correct horse battery staple' })).ok).toBe(true);
  });
});
