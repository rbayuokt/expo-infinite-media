import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

type ItemBase = {
  /** Stable identity. Players, caches and overlays are keyed by it. */
  id: string;
  uri: string;
  /**
   * Shown until the real media is ready: the first video frame, or the full photo. A tiny
   * blurred version works well, it arrives in a fraction of the time.
   */
  poster?: string;
  width?: number;
  height?: number;
  headers?: Record<string, string>;
  /** Cache key when `uri` is not stable (signed URLs). Defaults to `id`. */
  cacheKey?: string;
};

export type InfiniteMediaVideoItem = ItemBase & {
  type: 'video';
  /** Seconds, if known up front. */
  duration?: number;
};

export type InfiniteMediaImageItem = ItemBase & { type: 'image' };

export type InfiniteMediaItem = InfiniteMediaVideoItem | InfiniteMediaImageItem;

export type PlaybackState =
  | 'idle'
  | 'poster'
  | 'preparing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

export type InfiniteMediaErrorCode =
  | 'NETWORK_UNAVAILABLE'
  | 'HTTP_ERROR'
  | 'TIMEOUT'
  | 'SOURCE_NOT_FOUND'
  | 'UNSUPPORTED_FORMAT'
  | 'DECODER_INIT_FAILED'
  | 'DECODE_FAILED'
  | 'IMAGE_DECODE_FAILED'
  | 'CACHE_CORRUPT'
  | 'PLAYER_FAILED'
  | 'UNKNOWN';

export type InfiniteMediaError = {
  itemId: string;
  code: InfiniteMediaErrorCode;
  /** For logs, not for UI. */
  message: string;
  /** false once automatic retries are exhausted or the error can't be retried. */
  recoverable: boolean;
  httpStatus?: number;
  nativeCode?: string;
  attempt: number;
};

export type IndexChangeEvent<T extends InfiniteMediaItem = InfiniteMediaItem> = {
  index: number;
  item: T;
};

export type PlaybackStateChangeEvent = { itemId: string; state: PlaybackState };

export type FirstFrameEvent = { itemId: string; startupMs: number; fromCache: boolean };

export type ProgressEvent = {
  itemId: string;
  /** Seconds. */
  position: number;
  duration: number;
  buffered: number;
};

export type InfiniteMediaMetrics = {
  startupMsP50: number;
  startupMsP90: number;
  firstFrames: number;
  rebufferCount: number;
  rebufferMs: number;
  cacheHits: number;
  cacheMisses: number;
  bytesActive: number;
  bytesSpeculative: number;
  bytesWasted: number;
  preloadCancels: number;
  droppedFrames: number;
  playersActive: number;
  playersPrepared: number;
  playersTotal: number;
  liveObservers: number;
  liveSurfaces: number;
  memoryWarnings: number;
  errors: number;
  videoCacheBytes: number;
  imageCacheBytes: number;
};

export type ResizeMode = 'cover' | 'contain';

export type ScrubberColors = {
  track?: string;
  buffered?: string;
  fill?: string;
  thumb?: string;
  time?: string;
};

export type ScrubberOptions = {
  /** Hold the bar this long before it takes the touch, in ms. Default 140. */
  holdDelay?: number;
  /** Track height at rest and while held. Defaults 3 and 8. */
  height?: number;
  expandedHeight?: number;
  /** Thumb diameter while held. Default 14, 0 hides it. */
  thumbSize?: number;
  /** Time bubble above the thumb. Default true. */
  showTime?: boolean;
  /** Seek while dragging, not only on release. Default true. */
  liveSeek?: boolean;
  /** Pause during the drag and resume after, if it was playing. Default true. */
  pauseWhileScrubbing?: boolean;
  /** Fade the bar out while the feed is swiped between pages. Default true. */
  hideWhileScrolling?: boolean;
  /** Space below the bar, usually the safe area inset. Default 0. */
  bottom?: number;
  /** Pins the bar this far from the top instead, for horizontal or story style feeds. */
  top?: number;
  /** Space on each side. Default 12. */
  horizontalInset?: number;
  colors?: ScrubberColors;
};

export type SeekEvent = { itemId: string; position: number };

export type RenderOverlayInfo<T extends InfiniteMediaItem> = {
  item: T;
  index: number;
  isActive: boolean;
};

export type InfiniteMediaFeedProps<T extends InfiniteMediaItem = InfiniteMediaItem> = {
  data: readonly T[];
  renderOverlay?: (info: RenderOverlayInfo<T>) => ReactNode;
  initialIndex?: number;
  /** Default false. */
  horizontal?: boolean;
  /** Pages mounted on each side of the current one. Default 2. */
  windowSize?: number;
  /** false releases players and stops preloading, for screens that lose focus. Default true. */
  active?: boolean;
  /** Default true. */
  autoplay?: boolean;
  /** Default true. */
  loop?: boolean;
  /** Default false. */
  muted?: boolean;
  /** Default 'cover'. */
  resizeMode?: ResizeMode;
  /** Upper bounds. The native policy may preload less under pressure. Default { ahead: 2, behind: 1 }. */
  preload?: { ahead?: number; behind?: number };
  /** Resume the same item when the app returns to foreground. Default true. */
  resumeOnForeground?: boolean;
  /** ms between onProgress events for the active video. 0 turns them off (default). Minimum 250. */
  progressInterval?: number;
  /** Emits aggregated onMetrics every 2 s. Default false. */
  diagnostics?: boolean;
  /**
   * Seek bar under the current video: hold to expand it, drag to scrub. `true` uses the
   * defaults. It needs react-native-reanimated and react-native-gesture-handler, and is
   * skipped with a warning when they aren't installed.
   */
  scrubber?: boolean | ScrubberOptions;
  /** Pages from the end that trigger onEndReached. Default 3. */
  onEndReachedThreshold?: number;
  onIndexChange?: (event: IndexChangeEvent<T>) => void;
  onPlaybackStateChange?: (event: PlaybackStateChangeEvent) => void;
  onFirstFrame?: (event: FirstFrameEvent) => void;
  onProgress?: (event: ProgressEvent) => void;
  onError?: (event: InfiniteMediaError) => void;
  onEndReached?: () => void;
  /** The user scrubbed to a new position. */
  onSeek?: (event: SeekEvent) => void;
  /** The scrubber took the touch. Good moment to fade overlays out. */
  onScrubStart?: (event: { itemId: string }) => void;
  onScrubEnd?: (event: SeekEvent) => void;
  onMetrics?: (metrics: InfiniteMediaMetrics) => void;
  style?: StyleProp<ViewStyle>;
  /** Rendered behind media, also what shows on a page that isn't mounted yet. Default black. */
  backgroundColor?: string;
};

export type InfiniteMediaFeedRef = {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  setMuted(muted: boolean): void;
  scrollToIndex(index: number, animated?: boolean): void;
  /** Restarts the active item after an error, with a fresh retry budget. */
  retry(): void;
};

export type CacheStatus = { state: 'none' | 'partial' | 'complete'; bytes: number };

export type CacheSize = { videoBytes: number; imageBytes: number };

export type InfiniteMediaConfig = {
  /** Default 500 MB. */
  maxVideoDiskBytes?: number;
  /** Default 200 MB. */
  maxImageDiskBytes?: number;
  /** Decoded image memory cache. Default 64 MB on iOS, 1/8 of the app heap on Android. */
  maxImageMemoryBytes?: number;
  /** Default 'warn'. */
  logLevel?: 'none' | 'error' | 'warn' | 'debug';
  /** iOS: let feed audio mix with other apps. Default false. */
  mixWithOthers?: boolean;
};
