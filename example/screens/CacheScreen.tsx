import { Ionicons } from '@expo/vector-icons';
import { InfiniteMedia, type CacheStatus } from '@rbayuokt/expo-infinite-media';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionRow, ActionSection } from '../components/ActionList';
import { Page } from '../components/Page';
import { color, eyebrow, radius } from '../theme';
import { makePage } from '../data/media';

const SAMPLE = makePage(0, 10);
const LIMIT = 300 * 1024 * 1024; // matches InfiniteMedia.configure in App.tsx
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const BADGE: Record<CacheStatus['state'], { label: string; tint: string }> = {
  none: { label: 'Not cached', tint: color.faint },
  partial: { label: 'Partial', tint: color.amber },
  complete: { label: 'Cached', tint: color.lime },
};

export function CacheScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ videoBytes: 0, imageBytes: 0 });
  const [statuses, setStatuses] = useState<Record<string, CacheStatus>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setSize(await InfiniteMedia.getCacheSize());
    const entries = await Promise.all(
      SAMPLE.map(async (item) => [item.id, await InfiniteMedia.getCacheStatus(item.id)] as const)
    );
    setStatuses(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (label: string, job: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await job();
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const confirmClear = () =>
    Alert.alert('Clear cache?', 'Every cached video and photo is deleted. Playback will download them again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => run('clear', () => InfiniteMedia.clearCache()) },
    ]);

  const total = size.videoBytes + size.imageBytes;
  const videoShare = total > 0 ? size.videoBytes / Math.max(total, LIMIT) : 0;
  const imageShare = total > 0 ? size.imageBytes / Math.max(total, LIMIT) : 0;

  return (
    <Page kicker="Storage" title="Cache" onBack={onBack}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={color.muted}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }>
        <View style={styles.storage}>
          <Text style={styles.total}>{mb(total)}</Text>
          <Text style={styles.totalLabel}>on disk</Text>
          <View style={styles.bar}>
            <View style={[styles.segment, { flex: videoShare, backgroundColor: color.violet }]} />
            <View style={[styles.segment, { flex: imageShare, backgroundColor: color.sky }]} />
            <View style={{ flex: Math.max(0, 1 - videoShare - imageShare) }} />
          </View>
          <View style={styles.legend}>
            <Legend tint={color.violet} label="Video" value={mb(size.videoBytes)} />
            <Legend tint={color.sky} label="Photos" value={mb(size.imageBytes)} />
          </View>
        </View>

        <ActionSection title="Actions" note="Preload caches the first ~1.5 MB of each video and the full photo.">
          <ActionRow
            icon="cloud-download"
            accent={color.lime}
            label="Preload first 10 posts"
            trailing={busy === 'preload' ? <ActivityIndicator color={color.muted} /> : undefined}
            onPress={() => run('preload', () => InfiniteMedia.preload(SAMPLE))}
          />
          <ActionRow
            icon="remove-circle"
            accent={color.amber}
            label="Remove post #1"
            trailing={busy === 'remove' ? <ActivityIndicator color={color.muted} /> : undefined}
            onPress={() => run('remove', () => InfiniteMedia.removeFromCache(SAMPLE[0].id))}
          />
          <ActionRow
            icon="trash"
            label="Clear everything"
            danger
            trailing={busy === 'clear' ? <ActivityIndicator color={color.muted} /> : undefined}
            onPress={confirmClear}
          />
        </ActionSection>

        <ActionSection title="First 10 posts" note="Pull down to refresh.">
          {SAMPLE.map((item, i) => {
            const s = statuses[item.id];
            const badge = BADGE[s?.state ?? 'none'];
            return (
              <ActionRow
                key={item.id}
                icon={item.type === 'video' ? 'videocam' : 'image'}
                accent={item.type === 'video' ? color.violet : color.sky}
                label={`Post #${i + 1}`}
                detail={s && s.bytes > 0 ? mb(s.bytes) : item.type === 'video' ? 'Video' : 'Photo'}
                trailing={
                  <View style={[styles.badge, { borderColor: badge.tint }]}>
                    <Text style={[styles.badgeText, { color: badge.tint }]}>{badge.label}</Text>
                  </View>
                }
              />
            );
          })}
        </ActionSection>
      </ScrollView>
    </Page>
  );
}

function Legend({ tint, label, value }: { tint: string; label: string; value: string }) {
  return (
    <View style={styles.legendItem}>
      <Ionicons name="ellipse" size={10} color={tint} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Text style={styles.legendValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 12, gap: 26 },
  storage: { backgroundColor: color.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, padding: 20, gap: 2 },
  total: { color: color.text, fontSize: 40, fontWeight: '900', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  totalLabel: eyebrow,
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: color.raised,
    marginTop: 14,
  },
  segment: { height: '100%' },
  legend: { flexDirection: 'row', gap: 20, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendLabel: { color: color.muted, fontSize: 13 },
  legendValue: { color: color.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  badge: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
