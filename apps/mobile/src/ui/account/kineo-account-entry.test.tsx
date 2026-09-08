import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import type { KineoAccountSession } from '../../application/account/kineo-account-session';
import type { KineoProductServing } from '../../application/kineo-product-service';
import type { KineoAccountRuntime } from '../../infrastructure/account/kineo-account-runtime';
import { KineoAccountEntry } from './kineo-account-entry';

jest.mock('../product/kineo-product-app', () => {
  const { Pressable: MockPressable, Text: MockText, View: MockView } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    KineoProductApp: ({ accountActions }: {
      accountActions?: Readonly<{
        deleteAccount(password?: string): Promise<unknown>;
      }>;
    }) => (
      <MockView>
        <MockText>PRODUCT READY</MockText>
        {accountActions === undefined ? null : (
          <MockPressable
            accessibilityLabel="TEST DELETE ACCOUNT"
            accessibilityRole="button"
            onPress={() => void accountActions.deleteAccount()}
          >
            <MockText>TEST DELETE ACCOUNT</MockText>
          </MockPressable>
        )}
      </MockView>
    ),
  };
});

const accountId = '10000000-0000-4000-8000-000000000001';
const bootstrap = {
  account: {
    accountId,
    status: 'active' as const,
    historyEpoch: 1,
    legalAcceptances: [],
  },
};

describe('KineoAccountEntry', () => {
  it('finishes expired logout through explicit isolated sign-in without hydrating history', async () => {
    const loadStartState = jest.fn<KineoProductServing['loadStartState']>();
    const restoreSession = jest.fn<KineoAccountRuntime['auth']['restoreSession']>();
    const recover = jest.fn<KineoAccountRuntime['reauthenticatePendingLogout']>()
      .mockResolvedValue({ ok: true, value: { kind: 'complete' } });
    const restart = jest.fn();
    const runtime = {
      resumePendingDeletion: async () => ({ ok: true, value: undefined }),
      resumePendingLogout: async () => ({ ok: true, value: {
        kind: 'pending', localWiped: true, canReauthenticate: true, error: { code: 'sessionExpired' },
      } }),
      reauthenticatePendingLogout: recover,
      auth: { restoreSession },
    } as unknown as KineoAccountRuntime;
    const service = { loadStartState } as unknown as KineoProductServing;
    const view = await render(<KineoAccountEntry runtime={runtime} service={service}
      createAuthorizedService={async () => ({ ok: true, value: service })}
      onStoreRestartRequired={restart} />);
    expect(await view.findByText('Sign in to finish signing out')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('Recovery email'), 'person@example.com');
    await fireEvent.changeText(view.getByLabelText('Recovery password'), 'correct horse battery staple');
    await fireEvent.press(view.getByRole('button', { name: 'Use email to finish signing out' }));
    await waitFor(() => expect(recover).toHaveBeenCalledWith({ kind: 'email', credentials: {
      email: 'person@example.com', password: 'correct horse battery staple',
    } }));
    expect(restart).toHaveBeenCalledTimes(1);
    expect(loadStartState).not.toHaveBeenCalled();
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it('restarts after completed logout recovery without opening the old store or restoring Auth', async () => {
    const loadStartState = jest.fn<KineoProductServing['loadStartState']>();
    const restoreSession = jest.fn<KineoAccountRuntime['auth']['restoreSession']>();
    const restart = jest.fn();
    const runtime = {
      resumePendingDeletion: async () => ({ ok: true, value: undefined }),
      resumePendingLogout: async () => ({ ok: true, value: { kind: 'complete' } }),
      auth: { restoreSession },
    } as unknown as KineoAccountRuntime;
    const service = { loadStartState } as unknown as KineoProductServing;
    await render(<KineoAccountEntry runtime={runtime} service={service}
      createAuthorizedService={async () => ({ ok: true, value: service })}
      onStoreRestartRequired={restart} />);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(loadStartState).not.toHaveBeenCalled();
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it('gates pending offline logout before auth or private cached data and offers retry', async () => {
    const loadStartState = jest.fn<KineoProductServing['loadStartState']>();
    const restoreSession = jest.fn<KineoAccountRuntime['auth']['restoreSession']>();
    const order: string[] = [];
    const restart = jest.fn();
    const runtime = {
      resumePendingDeletion: async () => { order.push('deletion'); return { ok: true, value: undefined }; },
      resumePendingLogout: async () => {
        order.push('logout');
        return { ok: true, value: { kind: 'pending', localWiped: true, error: { code: 'offline' } } };
      },
      auth: { restoreSession },
    } as unknown as KineoAccountRuntime;
    const service = { loadStartState } as unknown as KineoProductServing;
    const view = await render(<KineoAccountEntry runtime={runtime} service={service}
      createAuthorizedService={async () => ({ ok: true, value: service })}
      onStoreRestartRequired={restart} />);
    expect(await view.findByText('Signed out on this device. Connect to the internet to finish signing out securely.')).toBeTruthy();
    expect(order).toEqual(['deletion', 'logout']);
    expect(loadStartState).not.toHaveBeenCalled();
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it('resumes deletion before authentication or opening product data', async () => {
    const loadStartState = jest.fn<KineoProductServing['loadStartState']>();
    const restoreSession = jest.fn<KineoAccountRuntime['auth']['restoreSession']>();
    const restart = jest.fn();
    const runtime = {
      resumePendingDeletion: async () => ({ ok: true, value: { kind: 'complete' } }),
      auth: { restoreSession },
    } as unknown as KineoAccountRuntime;
    const service = { loadStartState } as unknown as KineoProductServing;
    await render(<KineoAccountEntry runtime={runtime} service={service}
      createAuthorizedService={async () => ({ ok: true, value: service })}
      onStoreRestartRequired={restart} />);
    await waitFor(() => expect(restart).toHaveBeenCalledTimes(1));
    expect(restoreSession).not.toHaveBeenCalled();
    expect(loadStartState).not.toHaveBeenCalled();
  });

  it('opens cached history without attempting online profile synchronization', async () => {
    const service = {
      loadStartState: async () => ({ ok: true, value: { kind: 'ready' } }),
    } as unknown as KineoProductServing;
    const remoteBootstrap = jest.fn<KineoAccountSession['bootstrap']>();
    const session = {
      bootstrap: remoteBootstrap,
      cachedState: async () => ({ ok: true, value: bootstrap }),
      hasCurrentLegalAcceptances: () => true,
    } as unknown as KineoAccountSession;
    const runtime = {
      resumePendingDeletion: async () => ({ ok: true, value: undefined }),
      resumePendingLogout: async () => ({ ok: true, value: { kind: 'none' } }),
      auth: { restoreSession: async () => ({ ok: true, value: { kind: 'cached', accountId, provider: 'email' } }) },
      connect: async () => ({ ok: true, value: session }),
    } as unknown as KineoAccountRuntime;
    const authorize = jest.fn<(_: KineoAccountSession, offline: boolean) => Promise<{ ok: true; value: KineoProductServing }>>()
      .mockResolvedValue({ ok: true, value: service });
    const view = await render(<KineoAccountEntry service={service} runtime={runtime}
      createAuthorizedService={authorize} onStoreRestartRequired={() => undefined} />);
    expect(await view.findByText('PRODUCT READY')).toBeTruthy();
    expect(remoteBootstrap).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith(session, true);
  });

  it('allows passwordless reauthentication for an internal test account', async () => {
    const grant = {
      value: 'development-grant',
      expiresAtMilliseconds: 1_788_300_300_000,
    };
    const reauthenticate = jest.fn<
      KineoAccountRuntime['auth']['reauthenticate']
    >().mockResolvedValue({ ok: true, value: grant });
    const deleteAccount = jest.fn<
      KineoAccountSession['privacy']['deleteAccount']
    >().mockResolvedValue({ ok: true, value: { kind: 'complete' } });
    const service = {
      loadStartState: async () => ({
        ok: true as const,
        value: { kind: 'today' as const, primaryArea: 'neck' as const },
      }),
    } as unknown as KineoProductServing;
    const session = {
      provider: 'email',
      bootstrap: async () => ({ ok: true as const, value: bootstrap }),
      hasCurrentLegalAcceptances: () => true,
      privacy: { deleteAccount },
    } as unknown as KineoAccountSession;
    const runtime = {
      usesDevelopmentServices: true,
      resumePendingDeletion: async () => ({ ok: true, value: undefined }),
      resumePendingLogout: async () => ({ ok: true, value: { kind: 'none' } }),
      auth: {
        restoreSession: async () => ({
          ok: true as const,
          value: {
            kind: 'authenticated' as const,
            accountId,
            provider: 'email' as const,
          },
        }),
        reauthenticate,
      },
      connect: async () => ({ ok: true as const, value: session }),
    } as unknown as KineoAccountRuntime;
    const view = await render(
      <KineoAccountEntry
        service={service}
        runtime={runtime}
        createAuthorizedService={async () => ({ ok: true, value: service })}
        onStoreRestartRequired={() => undefined}
      />,
    );

    await fireEvent.press(
      await view.findByRole('button', { name: 'TEST DELETE ACCOUNT' }),
    );
    await waitFor(() => expect(reauthenticate).toHaveBeenCalledWith({
      kind: 'password',
      password: '',
    }));
    expect(deleteAccount).toHaveBeenCalledWith(grant);
  });

  it('enforces promise, adult declaration, authentication, legal, then product order', async () => {
    const service = {
      loadStartState: async () => ({
        ok: true as const,
        value: {
          kind: 'onboarding' as const,
          progress: { step: 'welcome' as const },
        },
      }),
      confirmAdultEligibility: async () => ({
        ok: true as const,
        value: undefined,
      }),
    } as unknown as KineoProductServing;
    const session = {
      bootstrap: async () => ({ ok: true as const, value: bootstrap }),
      cachedState: async () => ({ ok: true as const, value: undefined }),
      hasCurrentLegalAcceptances: () => false,
      acceptCurrentLegalDocuments: async () => ({
        ok: true as const,
        value: bootstrap,
      }),
    } as unknown as KineoAccountSession;
    const runtime = {
      resumePendingDeletion: async () => ({ ok: true, value: undefined }),
      resumePendingLogout: async () => ({ ok: true, value: { kind: 'none' } }),
      usesDevelopmentServices: true,
      auth: {
        restoreSession: async () => ({
          ok: true as const,
          value: { kind: 'signedOut' as const },
        }),
        signInWithApple: async () => ({
          ok: true as const,
          value: {
            kind: 'authenticated' as const,
            accountId,
            provider: 'apple' as const,
          },
        }),
      },
      connect: async () => ({ ok: true as const, value: session }),
    } as unknown as KineoAccountRuntime;

    const view = await render(
      <KineoAccountEntry
        service={service}
        runtime={runtime}
        createAuthorizedService={async () => ({ ok: true, value: service })}
        onStoreRestartRequired={() => undefined}
      />,
    );

    expect(await view.findByText('A routine shaped around how you feel now.')).toBeTruthy();
    expect(view.queryByText('WELCOME TO KINEO')).toBeNull();

    await fireEvent.press(view.getByText('Get started'));
    expect(view.getByText('Are you 18 or older?')).toBeTruthy();

    await fireEvent.press(view.getByText('Yes, I’m 18 or older'));
    expect(await view.findByText('Keep your progress with you')).toBeTruthy();

    await fireEvent.press(view.getByText('Continue with test account'));
    expect(await view.findByText('Review before continuing')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Read prototype Terms of Service' })).toBeTruthy();

    await fireEvent.press(view.getByRole('checkbox'));
    await fireEvent.press(view.getByText('Accept and continue'));
    await waitFor(() => expect(view.getByText('PRODUCT READY')).toBeTruthy());
  });
});
