import { NativeModule, requireNativeModule, SharedObject } from 'expo';

import type {
  CacheSize,
  CacheStatus,
  FirstFrameEvent,
  InfiniteMediaConfig,
  InfiniteMediaError,
  InfiniteMediaItem,
  InfiniteMediaMetrics,
  PlaybackStateChangeEvent,
  ProgressEvent,
} from './types';

/** What crosses the bridge per item. App fields like captions stay in JS. */
export type NativeItem = {
  id: string;
  type: 'video' | 'image';
  uri: string;
  poster?: string;
  headers?: Record<string, string>;
  cacheKey?: string;
};

export type SessionConfig = {
  active: boolean;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preloadAhead: number;
  preloadBehind: number;
  resumeOnForeground: boolean;
  progressInterval: number;
  diagnostics: boolean;
};

type SessionEvents = {
  indexChange(event: { index: number; itemId: string }): void;
  playbackStateChange(event: PlaybackStateChangeEvent): void;
  firstFrame(event: FirstFrameEvent): void;
  progress(event: ProgressEvent): void;
  error(event: InfiniteMediaError): void;
  metrics(event: InfiniteMediaMetrics): void;
};

export declare class FeedSession extends SharedObject<SessionEvents> {
  constructor();
  setItems(items: NativeItem[]): void;
  appendItems(items: NativeItem[]): void;
  setConfig(config: SessionConfig): void;
  play(): void;
  pause(): void;
  /** `precise: false` lands on the nearest keyframe, which is what scrubbing wants. */
  seekTo(seconds: number, precise?: boolean): void;
  setMuted(muted: boolean): void;
  retry(): void;
}

declare class ExpoInfiniteMediaModule extends NativeModule {
  FeedSession: typeof FeedSession;
  configure(config: InfiniteMediaConfig): void;
  preload(items: NativeItem[]): Promise<void>;
  cancelPreload(ids: string[]): void;
  clearCache(): Promise<void>;
  removeFromCache(idOrCacheKey: string): Promise<void>;
  getCacheSize(): Promise<CacheSize>;
  getCacheStatus(idOrCacheKey: string): Promise<CacheStatus>;
}

const native = requireNativeModule<ExpoInfiniteMediaModule>('ExpoInfiniteMedia');
export default native;

export function toNativeItem(item: InfiniteMediaItem): NativeItem {
  const out: NativeItem = { id: item.id, type: item.type, uri: item.uri };
  if (item.poster) out.poster = item.poster;
  if (item.headers) out.headers = item.headers;
  if (item.cacheKey) out.cacheKey = item.cacheKey;
  return out;
}
