import { Platform } from 'react-native';

import type { InfiniteMediaMetrics } from '@rbayuokt/expo-infinite-media';

export const BENCHMARK_SECONDS = 60;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** One markdown table row, ready to paste under a device heading in the README. */
export function benchmarkRow(m: InfiniteMediaMetrics, seconds: number) {
  const lookups = m.cacheHits + m.cacheMisses;
  const hitRate = lookups > 0 ? Math.round((100 * m.cacheHits) / lookups) : 0;
  const cells = [
    `${Platform.OS} ${Platform.Version}`,
    `${seconds}s`,
    String(m.firstFrames),
    `${m.startupMsP50} / ${m.startupMsP90} ms`,
    `${m.rebufferCount} (${m.rebufferMs} ms)`,
    String(m.droppedFrames),
    `${hitRate}%`,
    // Everything that crossed the network: playback plus preload.
    mb(m.bytesActive + m.bytesSpeculative),
    mb(m.bytesWasted),
    mb(m.videoCacheBytes),
    `${m.playersTotal} / ${m.liveSurfaces}`,
  ];
  return `| ${cells.join(' | ')} |`;
}

export const BENCHMARK_HEADER =
  '| Device | Run | First frames | TTFF p50 / p90 | Rebuffers | Dropped | Cache hits | Network total | Wasted | On disk | Players / surfaces |';
