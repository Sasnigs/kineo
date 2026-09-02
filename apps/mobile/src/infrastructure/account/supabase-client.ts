import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Result } from '../../core/shared/result';

export type SupabaseConfigurationError =
  Readonly<{ code: 'configurationMissing' }>;

export function createConfiguredSupabaseClient(): Result<
  SupabaseClient,
  SupabaseConfigurationError
> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (
    url === undefined ||
    url.length === 0 ||
    publishableKey === undefined ||
    publishableKey.length === 0
  ) {
    return { ok: false, error: { code: 'configurationMissing' } };
  }
  try {
    return {
      ok: true,
      value: createClient(url, publishableKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        realtime: {
          params: { eventsPerSecond: 0 },
        },
      }),
    };
  } catch {
    return { ok: false, error: { code: 'configurationMissing' } };
  }
}
