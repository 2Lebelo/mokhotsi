module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 57) adds `react-native-worklets/plugin` automatically when
    // react-native-worklets is installed, so it must NOT be listed again here.
    presets: ['babel-preset-expo'],
    // Inline Drizzle `.sql` migrations as strings (Drizzle "Expo SQLite" guide).
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
