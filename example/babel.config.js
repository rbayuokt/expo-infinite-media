module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-preset-expo resolves from the library root, where react-native-worklets isn't a
    // dependency, so its auto-detection misses it. This must stay last.
    plugins: ['react-native-worklets/plugin'],
  };
};
