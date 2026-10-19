import { NativeModule, registerWebModule } from 'expo';

import type { InfiniteMediaConfig, InfiniteMediaItem } from './types';

export type NativeItem = {
  id: string;
  type: 'video' | 'image';
  uri: string;
  poster?: string;
  headers?: Record<string, string>;
  cacheKey?: string;
};

/** Same shape the native module takes, so `index.ts` can stay platform agnostic. */
export function toNativeItem(item: InfiniteMediaItem): NativeItem {
  const out: NativeItem = { id: item.id, type: item.type, uri: item.uri };
  if (item.poster) out.poster = item.poster;
  if (item.headers) out.headers = item.headers;
  if (item.cacheKey) out.cacheKey = item.cacheKey;
  return out;
}

/**
 * The web feed owns its own `<video>` elements, so there is no session object here. These
 * are the process-wide calls, mapped onto what a browser actually offers: posters can be
 * warmed, bytes and eviction belong to the browser's HTTP cache.
 */
class ExpoInfiniteMediaModule extends NativeModule<{}> {
  FeedSession = class {};

  configure = (_config: InfiniteMediaConfig) => {};

  preload = async (items: InfiniteMediaItem[]) => {
    await Promise.all(
      items.map(
        (item) =>
          new Promise<void>((resolve) => {
            const url = item.type === 'image' ? item.uri : item.poster;
            if (!url) return resolve();
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
          })
      )
    );
  };

  cancelPreload = (_ids: string[]) => {};

  clearCache = async () => {};

  removeFromCache = async (_key: string) => {};

  getCacheSize = async () => ({ videoBytes: 0, imageBytes: 0 });

  getCacheStatus = async (_key: string) => ({ state: 'none' as const, bytes: 0 });
}

export default registerWebModule(ExpoInfiniteMediaModule, 'ExpoInfiniteMedia');
