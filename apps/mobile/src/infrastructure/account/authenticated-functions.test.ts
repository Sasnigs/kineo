import { describe, expect, it, jest } from '@jest/globals';

import { AuthenticatedFunctions } from './authenticated-functions';
import type { SupabaseFunctionsPort } from './supabase-sync-transport';

describe('authenticated function requests', () => {
  it('uses the centrally refreshed token for each request', async () => {
    const invoke = jest.fn<SupabaseFunctionsPort['invoke']>().mockResolvedValue({ data: {}, error: null });
    const port = new AuthenticatedFunctions({ invoke }, async () => ({ ok: true, value: 'current-access' }));
    await port.invoke('bootstrap', { body: { installationId: 'device' } });
    expect(invoke).toHaveBeenCalledWith('bootstrap', {
      body: { installationId: 'device' }, headers: { Authorization: 'Bearer current-access' },
    });
  });

  it('does not submit a command when refresh is unavailable', async () => {
    const invoke = jest.fn<SupabaseFunctionsPort['invoke']>();
    const port = new AuthenticatedFunctions({ invoke }, async () => ({ ok: false, error: { code: 'offline' } }));
    expect(await port.invoke('sync', { body: {} })).toEqual({
      data: null, error: { name: 'FunctionsFetchError' },
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});
