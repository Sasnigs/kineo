const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/**', '**/* 2.*'],
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-native', 'expo', 'expo-*', '@expo/*'],
              message: 'Kineo Core must remain independent of UI and native frameworks.',
            },
          ],
        },
      ],
    },
  },
]);
