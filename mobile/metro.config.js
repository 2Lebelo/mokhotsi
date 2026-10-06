// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle `.tflite` models as assets (react-native-fast-tflite README).
config.resolver.assetExts.push('tflite');
// Bundle Drizzle `.sql` migrations as source (Drizzle "Expo SQLite" guide).
config.resolver.sourceExts.push('sql');

module.exports = config;
