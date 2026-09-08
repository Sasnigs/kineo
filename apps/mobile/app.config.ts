import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const googleUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;
const internalAccountMode = process.env.EXPO_PUBLIC_KINEO_ACCOUNT_MODE === 'internal-test';
const productionBuild = process.env.EAS_BUILD_PROFILE === 'production';

export default ({ config }: ConfigContext): ExpoConfig => {
  if (internalAccountMode && productionBuild) {
    throw new Error('Internal account services cannot be enabled in production.');
  }
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
  };
};
