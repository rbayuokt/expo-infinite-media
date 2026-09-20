import { NativeModule, registerWebModule } from 'expo';

function unsupported(): never {
  const error = new Error('expo-infinite-media is not available on web.');
  (error as Error & { code: string }).code = 'UNSUPPORTED_PLATFORM';
  throw error;
}

class ExpoInfiniteMediaModule extends NativeModule<{}> {
  FeedSession = class {
    constructor() {
      unsupported();
    }
  };
  configure = unsupported;
  preload = async () => unsupported();
  cancelPreload = unsupported;
  clearCache = async () => unsupported();
  removeFromCache = async () => unsupported();
  getCacheSize = async () => unsupported();
  getCacheStatus = async () => unsupported();
}

export default registerWebModule(ExpoInfiniteMediaModule, 'ExpoInfiniteMedia');
