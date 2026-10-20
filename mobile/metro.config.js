// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Bundle on-device `.tflite` models as assets (react-native-fast-tflite README).
config.resolver.assetExts.push("tflite");

module.exports = config;
