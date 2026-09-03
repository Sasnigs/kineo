import { describe, expect, it } from '@jest/globals';

import type { SupabaseFunctionsPort } from './supabase-sync-transport';
import { SupabaseSyncTransport } from './supabase-sync-transport';

const metadata = {
  installationId: '20000000-0000-4000-8000-000000000001',
  appVersion: '1.0.0',
  platformVersion: '26.0',
};
const accountId = '10000000-0000-4000-8000-000000000001';

class FakeFunctions implements SupabaseFunctionsPort {
  response: Awaited<ReturnType<SupabaseFunctionsPort['invoke']>> = {
    data: null,
    error: null,
  };

  async invoke() {
    return this.response;
  }
}

describe('SupabaseSyncTransport', () => {
  it('parses a valid bootstrap response', async () => {
    const functions = new FakeFunctions();
    functions.response = {
      data: {
        account: {
          accountId,
          status: 'active',
          historyEpoch: 1,
          legalAcceptances: [],
        },
        changes: [],
        hasMore: false,
      },
      error: null,
    };
    const transport = new SupabaseSyncTransport(functions, metadata);

    await expect(transport.bootstrap()).resolves.toEqual({
      ok: true,
      value: {
        account: {
          accountId,
          status: 'active',
          historyEpoch: 1,
          legalAcceptances: [],
        },
        changes: [],
        hasMore: false,
      },
    });
  });

  it('rejects malformed server data', async () => {
    const functions = new FakeFunctions();
    functions.response = {
      data: { account: { accountId }, changes: [], hasMore: false },
      error: null,
    };
    const transport = new SupabaseSyncTransport(functions, metadata);

    await expect(transport.bootstrap()).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' },
    });
  });

  it('maps authentication errors without exposing infrastructure details', async () => {
    const functions = new FakeFunctions();
    functions.response = {
      data: null,
      error: { context: { status: 401 } },
    };
    const transport = new SupabaseSyncTransport(functions, metadata);

    await expect(transport.bootstrap()).resolves.toEqual({
      ok: false,
      error: { code: 'authenticationRequired' },
    });
  });
});
