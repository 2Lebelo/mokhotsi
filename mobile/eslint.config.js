// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

/** Import restrictions that enforce the folder layering (see docs/architecture.md). */
const SQLITE = [
  { name: 'expo-sqlite', message: 'Only src/db/ may touch SQLite.' },
  { name: 'drizzle-orm', message: 'Only src/db/ may touch SQLite.' },
];
const SQLITE_PATTERNS = [{ group: ['drizzle-orm/*'], message: 'Only src/db/ may touch SQLite.' }];

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', '.expo/*', 'drizzle/*'],
  },
  {
    rules: {
      // Treat .tflite like the other Metro asset types eslint-config-expo allows.
      '@typescript-eslint/no-require-imports': ['warn', { allow: ['\\.(json|png|tflite)$'] }],
    },
  },
  // Everything outside src/db/: no SQLite.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['src/db/**', 'drizzle.config.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: SQLITE, patterns: SQLITE_PATTERNS }],
    },
  },
  // Screens: only hooks/components from src/features/ (root layout may mount AppProviders).
  {
    files: ['app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...SQLITE,
            { name: 'react-native-vision-camera', message: 'Screens use src/features/ hooks/components.' },
            { name: 'react-native-fast-tflite', message: 'Screens use src/features/ hooks/components.' },
          ],
          patterns: [
            ...SQLITE_PATTERNS,
            {
              group: [
                '@/db',
                '@/db/*',
                '@/ml',
                '@/ml/*',
                '@/sync',
                '@/sync/*',
                '@/lib',
                '@/lib/*',
                '**/src/*',
              ],
              message: 'Screens may only import from @/features/* (see docs/architecture.md).',
            },
            {
              group: ['@/providers/*', '!@/providers/AppProviders'],
              message: 'Screens may only import from @/features/* (see docs/architecture.md).',
            },
          ],
        },
      ],
    },
  },
  // src/ml/: framework-free — no React, no DB, no app layers.
  {
    files: ['src/ml/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...SQLITE,
            { name: 'react', message: 'src/ml/ must not import React.' },
            { name: 'react-native', message: 'src/ml/ must not import React Native.' },
          ],
          patterns: [
            ...SQLITE_PATTERNS,
            {
              group: [
                '@/db',
                '@/db/*',
                '@/features/*',
                '@/providers/*',
                '@/sync/*',
                '../db/*',
                '../features/*',
              ],
              message: 'src/ml/ must not depend on the DB or app layers.',
            },
          ],
        },
      ],
    },
  },
]);
