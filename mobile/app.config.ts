import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * API base URL baked into the build.
 * - Local dev builds read it from `mobile/.env` (see `.env.example`).
 * - EAS builds read it from the `env` block of the profile in `eas.json`.
 * A phone must use the laptop's LAN IP (e.g. http://192.168.1.20:8000), never `localhost`.
 * `10.0.2.2` is the Android emulator's alias for the host machine.
 */
const API_URL = process.env.API_URL ?? 'http://10.0.2.2:8000';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Mokhotsi',
  slug: 'mokhotsi',
  scheme: 'mokhotsi',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription:
        'Mokhotsi uses the camera to recognise products at checkout and to photograph products when you add them.',
    },
  },
  android: {
    package: 'ls.mokhotsi.app',
    permissions: ['android.permission.CAMERA'],
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-sqlite',
    'expo-secure-store',
    ['react-native-fast-tflite', { enableAndroidGpuLibraries: true }],
  ],
  extra: {
    apiUrl: API_URL,
  },
});
