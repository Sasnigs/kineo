import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { createKineoExpoConfig } from '../../../app.config';

const buildConfig = (context: Parameters<typeof createKineoExpoConfig>[0]) => createKineoExpoConfig(context, process.env);

const originalEnvironment = process.env;
const context = { config: { name: 'Kineo', slug: 'kineo-mobile' } } as Parameters<typeof buildConfig>[0];

beforeEach(() => {
  process.env = { ...originalEnvironment };
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.EXPO_PUBLIC_KINEO_ACCOUNT_MODE;
  delete process.env.EAS_BUILD_PROFILE;
});
afterEach(() => { process.env = originalEnvironment; });

describe('portable preview account configuration', () => {
  it('embeds explicit internal mode for a clone without a backend or env file', () => {
    expect(buildConfig(context).extra).toMatchObject({
      kineoBuildProfile: 'preview', kineoPreviewAccountMode: 'internal-test',
    });
  });
  it('treats whitespace-only public credentials as absent', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = '  ';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = '';
    expect(buildConfig(context).extra?.kineoPreviewAccountMode).toBe('internal-test');
  });
  it('does not hide a partially configured backend behind local test accounts', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    expect(buildConfig(context).extra?.kineoPreviewAccountMode).toBeUndefined();
  });
  it('keeps configured backends and production builds out of automatic preview mode', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'public-key';
    expect(buildConfig(context).extra?.kineoPreviewAccountMode).toBeUndefined();
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.EAS_BUILD_PROFILE = 'production';
    expect(buildConfig(context).extra).toMatchObject({ kineoBuildProfile: 'production' });
    expect(buildConfig(context).extra?.kineoPreviewAccountMode).toBeUndefined();
  });
  it('continues to reject explicit internal accounts in production', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EXPO_PUBLIC_KINEO_ACCOUNT_MODE = 'internal-test';
    expect(() => buildConfig(context)).toThrow('Internal account services cannot be enabled in production.');
  });
});
