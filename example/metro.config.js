// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// The library root has its own dev copies of these in ../node_modules. Native-backed packages
// must load exactly once, so imports of them always resolve from the example.
const SINGLETONS = [
  'react',
  'react-native',
  'expo',
  'expo-modules-core',
  'react-native-reanimated',
  'react-native-gesture-handler',
  'react-native-worklets',
];
const exampleEntry = path.join(__dirname, 'index.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const shared = SINGLETONS.some((p) => moduleName === p || moduleName.startsWith(`${p}/`));
  return context.resolveRequest(
    shared ? { ...context, originModulePath: exampleEntry } : context,
    moduleName,
    platform
  );
};

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

config.resolver.extraNodeModules = {
  '@rbayuokt/expo-infinite-media': '..',
};

config.watchFolders = [path.resolve(__dirname, '..')];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
