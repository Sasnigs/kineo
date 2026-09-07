import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';

import type { KineoAccountSession } from '../../application/account/kineo-account-session';
import type { KineoProductServing } from '../../application/kineo-product-service';
import type { KineoAccountRuntime } from '../../infrastructure/account/kineo-account-runtime';
import { KineoAccountEntry } from './kineo-account-entry';

jest.mock('../product/kineo-product-app', () => {
  const { Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { KineoProductApp: () => <MockText>PRODUCT READY</MockText> };
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

    await fireEvent.press(view.getByRole('checkbox'));
    await fireEvent.press(view.getByText('Accept and continue'));
    await waitFor(() => expect(view.getByText('PRODUCT READY')).toBeTruthy());
  });
});
