import Native, { toNativeItem } from './ExpoInfiniteMediaModule';
import type { CacheSize, CacheStatus, InfiniteMediaConfig, InfiniteMediaItem } from './types';

export { InfiniteMediaFeed } from './InfiniteMediaFeed';
export { MediaScrubber } from './scrubber';
export type { MediaScrubberProps } from './scrubber';
export * from './types';

export const InfiniteMedia = {
  /** Process-wide cache and logging settings. Call once at startup, before any feed mounts. */
  configure(config: InfiniteMediaConfig): void {
    Native.configure(config);
  },
  /** Videos get their startup range cached, images are fetched and stored on disk. */
  preload(items: InfiniteMediaItem[]): Promise<void> {
    return Native.preload(items.map(toNativeItem));
  },
  cancelPreload(ids: string[]): void {
    Native.cancelPreload(ids);
  },
  clearCache(): Promise<void> {
    return Native.clearCache();
  },
  /** Takes the item id, or its cacheKey if it has one. */
  removeFromCache(key: string): Promise<void> {
    return Native.removeFromCache(key);
  },
  getCacheSize(): Promise<CacheSize> {
    return Native.getCacheSize();
  },
  getCacheStatus(key: string): Promise<CacheStatus> {
    return Native.getCacheStatus(key);
  },
};
