import type { ConfigContext, ExpoConfig } from 'expo/config';

import appJson from './app.json';

const googleUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;
  const plugins = [...(base.plugins ?? [])];
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
