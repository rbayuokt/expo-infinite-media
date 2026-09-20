import { InfiniteMediaFeed, type InfiniteMediaFeedRef, type InfiniteMediaMetrics } from '@rbayuokt/expo-infinite-media';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { GlassButton } from '../components/GlassButton';
import { Tabs } from '../components/Tabs';
import { StatGrid } from '../components/StatGrid';
import { color, font, radius, textShadow } from '../theme';
import { makePage } from '../data/media';
import { metricsStats } from './shared/metricsStats';
import { BENCHMARK_HEADER, BENCHMARK_SECONDS, benchmarkRow } from './shared/benchmark';

type Mode = 'off' | 'slow' | 'fast' | 'burst';

// The rapid-jump sequence from the spec, looped.
const BURST = [0, 1, 2, 3, 4, 10, 20, 21, 5, 100, 500, 499, 1000, 3];
const INTERVAL: Record<Mode, number> = { off: 0, slow: 3000, fast: 350, burst: 180 };
const MODES: { value: Mode; label: string }[] = [
  { value: 'off', label: 'Manual' },
  { value: 'slow', label: 'Slow' },
  { value: 'fast', label: 'Fast' },
  { value: 'burst', label: 'Burst' },
];

// EXPO_PUBLIC_STRESS_MODE=slow|fast|burst|remount|benchmark starts a run without touching
// the screen, which is how the benchmark rows in the README are produced.
const ENV_MODE = process.env.EXPO_PUBLIC_STRESS_MODE;

export function StressScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const data = useMemo(() => makePage(0, 1200, 'stress'), []);
  const ref = useRef<InfiniteMediaFeedRef>(null);
  const [mode, setMode] = useState<Mode>(
    ENV_MODE && ENV_MODE !== 'remount' && ENV_MODE !== 'benchmark' ? (ENV_MODE as Mode) : 'off'
  );
  const [metrics, setMetrics] = useState<InfiniteMediaMetrics | null>(null);
  const [index, setIndex] = useState(0);
  const [mountKey, setMountKey] = useState(0);
  const [cycles, setCycles] = useState(ENV_MODE === 'remount' ? 100 : 0);
  const [expanded, setExpanded] = useState(false);
  const [benchLeft, setBenchLeft] = useState(ENV_MODE === 'benchmark' ? BENCHMARK_SECONDS : 0);
  const [benchRow, setBenchRow] = useState<string | null>(null);
  const [floating, setFloating] = useState(false);
  const indexRef = useRef(0);
  const metricsRef = useRef<InfiniteMediaMetrics | null>(null);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // A fixed run, so two devices can be compared with the same numbers.
  useEffect(() => {
    if (benchLeft <= 0) return;
    const id = setTimeout(() => {
      const left = benchLeft - 1;
      setBenchLeft(left);
      if (left > 0) return;
      setMode('off');
      const m = metricsRef.current;
      if (!m) return;
      const row = benchmarkRow(m, BENCHMARK_SECONDS);
      setBenchRow(row);
      console.log(`\n${BENCHMARK_HEADER}\n${row}\n`);
    }, 1000);
    return () => clearTimeout(id);
  }, [benchLeft]);

  // Env driven runs start counting as soon as the feed is up.
  useEffect(() => {
    if (ENV_MODE === 'benchmark') setMode('slow');
  }, []);

  const startBenchmark = () => {
    setBenchRow(null);
    metricsRef.current = null;
    // The native counters run from the moment the feed mounts and never reset, so a fresh
    // feed is what makes the row about this run instead of everything since you arrived.
    setMountKey((k) => k + 1);
    setMode('slow');
    setBenchLeft(BENCHMARK_SECONDS);
  };

  // Drives the feed like a user would. This timer is the test harness, not how the library works.
  useEffect(() => {
    if (mode === 'off') return;
    let step = 0;
    const id = setInterval(() => {
      if (mode === 'burst') ref.current?.scrollToIndex(BURST[step++ % BURST.length], false);
      else ref.current?.scrollToIndex((indexRef.current + 1) % data.length, true);
    }, INTERVAL[mode]);
    return () => clearInterval(id);
  }, [mode, data.length]);

  // Mount and unmount the feed 50 times. The counters should come back to baseline after.
  useEffect(() => {
    if (cycles <= 0) return;
    const id = setTimeout(() => {
      setMountKey((k) => k + 1);
      setCycles((c) => c - 1);
    }, 250);
    return () => clearTimeout(id);
  }, [cycles]);

  const remounting = cycles > 0;

  return (
    <View style={styles.root}>
      {cycles % 2 === 1 ? null : (
        <InfiniteMediaFeed
          key={mountKey}
          ref={ref}
          data={data}
          muted
          diagnostics
          onIndexChange={({ index: i }) => setIndex(i)}
          onMetrics={(m) => {
            metricsRef.current = m;
            setMetrics(m);
          }}
        />
      )}

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        style={[styles.topShade, { height: insets.top + 96 }]}
      />
      <View style={[styles.header, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <GlassButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} />
        <View style={[styles.titleBlock, { top: insets.top + 4 }]} pointerEvents="none">
          <Text style={styles.title}>Stress test</Text>
          <Text style={styles.subtitle}>
            {index + 1} of {data.length}
          </Text>
        </View>
        <GlassButton
          icon="albums"
          active={floating}
          accessibilityLabel={floating ? 'Dock the panel' : 'Float the panel'}
          onPress={() => setFloating((f) => !f)}
        />
      </View>

      <View
        style={[
          styles.panel,
          floating
            ? [styles.panelFloat, { bottom: insets.bottom + 12, paddingBottom: 14 }]
            : { paddingBottom: insets.bottom + 14 },
        ]}>
        <Tabs options={MODES} value={mode} onChange={setMode} />
        <StatGrid stats={metricsStats(metrics, expanded)} />
        <View style={styles.actions}>
          <View style={styles.flex}>
            <Button
              variant="ghost"
              label={expanded ? 'Fewer stats' : 'All stats'}
              onPress={() => setExpanded((e) => !e)}
            />
          </View>
          <View style={styles.flex}>
            <Button
              variant="ghost"
              label={remounting ? `Remount ${Math.ceil(cycles / 2)}` : 'Remount ×50'}
              disabled={remounting || benchLeft > 0}
              onPress={() => {
                setMode('off');
                setCycles(100);
              }}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label={benchLeft > 0 ? `${benchLeft}s` : 'Benchmark'}
              disabled={benchLeft > 0 || remounting}
              onPress={startBenchmark}
            />
          </View>
        </View>
        {benchRow ? (
          <Text style={styles.result} selectable>
            {benchRow}
          </Text>
        ) : null}
        <Text style={styles.hint}>
          {benchRow
            ? `${BENCHMARK_SECONDS}s run, slow auto swipe, markdown row`
            : `Benchmark runs ${BENCHMARK_SECONDS}s of slow auto swiping, then prints a result row.`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  flex: { flex: 1 },
  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBlock: { position: 'absolute', left: 0, right: 0, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { color: color.text, fontSize: 17, fontWeight: '700', ...textShadow },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontVariant: ['tabular-nums'], ...textShadow },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7,7,11,0.92)',
    borderTopWidth: 1,
    borderColor: color.line,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  panelFloat: {
    left: 12,
    right: 12,
    backgroundColor: 'rgba(7,7,11,0.58)',
    borderWidth: 1,
    // Per corner, because the sheet's own top radii would otherwise win over borderRadius.
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  actions: { flexDirection: 'row', gap: 10 },
  hint: { color: color.faint, fontSize: 12, textAlign: 'center' },
  result: {
    color: color.lime,
    fontFamily: font.mono,
    fontSize: 10,
    lineHeight: 14,
    backgroundColor: 'rgba(200,255,61,0.08)',
    borderRadius: radius.sm,
    padding: 8,
  },
});
