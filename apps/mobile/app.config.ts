import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

// Only generated non-production preview builds may opt into local test accounts.
// A partially configured backend must fail closed rather than hide a typo.
export function createKineoExpoConfig({ config }: ConfigContext, environment: NodeJS.ProcessEnv): ExpoConfig {
  const googleUrlScheme = environment.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
  const internalAccountMode = environment.EXPO_PUBLIC_KINEO_ACCOUNT_MODE === 'internal-test';
  const productionBuild = environment.EAS_BUILD_PROFILE === 'production';
  const backendAbsent = !environment.EXPO_PUBLIC_SUPABASE_URL?.trim() &&
    !environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (internalAccountMode && productionBuild) {
    throw new Error('Internal account services cannot be enabled in production.');
  }
  const previewAccountMode = !productionBuild && (internalAccountMode || backendAbsent)
    ? 'internal-test' : undefined;
  const base = appJson.expo as ExpoConfig;
  const plugins = [...(base.plugins ?? []), 'expo-sharing'];
  if (googleUrlScheme !== undefined && googleUrlScheme.length > 0) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: googleUrlScheme },
    ]);
  }
  return {
    ...config,
    ...base,
    plugins,
    extra: {
      ...config.extra,
      ...base.extra,
      kineoBuildProfile: productionBuild ? 'production' : 'preview',
      kineoPreviewAccountMode: previewAccountMode,
    },
  };
}

export default (context: ConfigContext): ExpoConfig => createKineoExpoConfig(context, process.env);
