import type { InfiniteMediaMetrics } from '../types';
import type { VideoPool } from './pool';

const MEDIA = /\.(mp4|webm|mov|m3u8|jpg|jpeg|png|webp|avif)(\?|$)/i;

const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

export class WebMetrics {
  private startups: number[] = [];
  private waitingSince = new Map<string, number>();
  private rebufferCount = 0;
  private rebufferMs = 0;
  private errors = 0;

  constructor() {
    performance.setResourceTimingBufferSize?.(5000);
    performance.clearResourceTimings?.();
  }

  firstFrame(startupMs: number) {
    this.startups.push(startupMs);
  }

  state(itemId: string, state: string) {
    if (state === 'buffering') {
      if (!this.waitingSince.has(itemId)) this.waitingSince.set(itemId, performance.now());
      return;
    }
    const since = this.waitingSince.get(itemId);
    if (since == null) return;
    this.waitingSince.delete(itemId);
    this.rebufferCount += 1;
    this.rebufferMs += Math.round(performance.now() - since);
  }

  error() {
    this.errors += 1;
  }

  sample(pool: VideoPool): InfiniteMediaMetrics {
    let dropped = 0;
    let active = 0;
    let prepared = 0;
    let surfaces = 0;
    for (const el of pool.elements()) {
      dropped += el.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
      if (el.isConnected) surfaces += 1;
      if (!el.currentSrc) continue;
      if (el.paused) prepared += 1;
      else active += 1;
    }

    let bytes = 0;
    let hits = 0;
    let misses = 0;
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      if (!MEDIA.test(entry.name)) continue;
      if (entry.transferSize === 0 && entry.decodedBodySize === 0 && entry.encodedBodySize === 0) {
        continue;
      }
      bytes += entry.transferSize;
      if (entry.transferSize === 0) hits += 1;
      else misses += 1;
    }

    return {
      startupMsP50: percentile(this.startups, 50),
      startupMsP90: percentile(this.startups, 90),
      firstFrames: this.startups.length,
      rebufferCount: this.rebufferCount,
      rebufferMs: this.rebufferMs,
      cacheHits: hits,
      cacheMisses: misses,
      bytesActive: bytes,
      bytesSpeculative: 0,
      bytesWasted: 0,
      preloadCancels: 0,
      droppedFrames: dropped,
      playersActive: active,
      playersPrepared: prepared,
      playersTotal: pool.capacity,
      liveObservers: 1,
      liveSurfaces: surfaces,
      memoryWarnings: 0,
      errors: this.errors,
      videoCacheBytes: 0,
      imageCacheBytes: 0,
    };
  }
}
