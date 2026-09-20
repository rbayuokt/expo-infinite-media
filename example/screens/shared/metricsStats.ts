import type { InfiniteMediaMetrics } from '@rbayuokt/expo-infinite-media';

import type { Stat } from '../../components/StatGrid';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function metricsStats(m: InfiniteMediaMetrics | null, full = false): Stat[] {
  if (!m) return [{ label: 'collecting', value: '…' }];
  const lookups = m.cacheHits + m.cacheMisses;
  const hitRate = lookups > 0 ? Math.round((100 * m.cacheHits) / lookups) : 0;
  const core: Stat[] = [
    { label: 'first frame p50 / p90', value: `${m.startupMsP50} / ${m.startupMsP90} ms`, tone: m.startupMsP90 > 1500 ? 'warn' : 'ok' },
    { label: 'players act / prep / all', value: `${m.playersActive} / ${m.playersPrepared} / ${m.playersTotal}` },
    { label: 'rebuffers', value: `${m.rebufferCount} · ${m.rebufferMs} ms`, tone: m.rebufferCount > 0 ? 'warn' : 'ok' },
    { label: 'cache hit rate', value: `${hitRate}%` },
    { label: 'surfaces / observers', value: `${m.liveSurfaces} / ${m.liveObservers}` },
    { label: 'errors', value: String(m.errors), tone: m.errors > 0 ? 'bad' : 'ok' },
  ];
  if (!full) return core;
  return [
    ...core,
    { label: 'first frames', value: String(m.firstFrames) },
    { label: 'dropped frames', value: String(m.droppedFrames) },
    { label: 'bytes active', value: mb(m.bytesActive) },
    { label: 'bytes speculative', value: mb(m.bytesSpeculative) },
    { label: 'bytes wasted', value: mb(m.bytesWasted), tone: m.bytesWasted > 5 * 1024 * 1024 ? 'warn' : undefined },
    { label: 'preload cancels', value: String(m.preloadCancels) },
    { label: 'video cache', value: mb(m.videoCacheBytes) },
    { label: 'image cache', value: mb(m.imageCacheBytes) },
    { label: 'memory warnings', value: String(m.memoryWarnings), tone: m.memoryWarnings > 0 ? 'warn' : undefined },
  ];
}
