import {
  InfiniteMediaFeed,
  type InfiniteMediaError,
  type InfiniteMediaFeedRef,
  type InfiniteMediaMetrics,
  type PlaybackState,
  type RenderOverlayInfo,
} from '@rbayuokt/expo-infinite-media';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '../components/GlassButton';
import { ActionRow, ActionSection } from '../components/ActionList';
import { Sheet } from '../components/Sheet';
import { StatGrid } from '../components/StatGrid';
import { color, radius, textShadow } from '../theme';
import { fetchPage, makePage, type FeedItem } from '../data/media';
import { presetById, type FeedPreset } from '../data/presets';
import { FeedOverlay } from './FeedOverlay';
import { metricsStats } from './shared/metricsStats';

// EXPO_PUBLIC_START_INDEX=37 opens on the first broken item, to check errors without swiping.
const START_INDEX = Number(process.env.EXPO_PUBLIC_START_INDEX ?? 0) || 0;

type Props = {
  active: boolean;
  prefix?: string;
  title?: string;
  /** Id from data/presets. Controls overlay, seek bar, resize mode and paging. */
  presetId?: string;
  onBack: () => void;
  onOpenNested?: () => void;
};

function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const show = useCallback(
    (text: string) => {
      setMessage(text);
      opacity.stopAnimation();
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    },
    [opacity]
  );
  return { message, opacity, show };
}

export function FeedScreen({
  active,
  prefix = 'feed',
  title = 'For You',
  presetId,
  onBack,
  onOpenNested,
}: Props) {
  const insets = useSafeAreaInsets();
  const preset: FeedPreset = presetById(presetId);
  const ref = useRef<InfiniteMediaFeedRef>(null);
  const [items, setItems] = useState<FeedItem[]>(() => makePage(0, Math.max(20, START_INDEX + 10), prefix));
  const [loadingMore, setLoadingMore] = useState(false);
  const [muted, setMuted] = useState(preset.muted ?? false);
  const [diagnostics, setDiagnostics] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [metrics, setMetrics] = useState<InfiniteMediaMetrics | null>(null);
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set());
  const [playback, setPlayback] = useState<{ itemId: string; state: PlaybackState } | null>(null);
  const [errors, setErrors] = useState<Record<string, InfiniteMediaError>>({});
  const [index, setIndex] = useState(START_INDEX);
  const loadingRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);
  const toast = useToast();

  // Sheets and modals over the feed pause it, like a real app would.
  useEffect(() => {
    if (sheet) ref.current?.pause();
  }, [sheet]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    const start = items.length;
    const page = await fetchPage(start, 20);
    setItems((prev) => (prev.length === start ? [...prev, ...page] : prev));
    loadingRef.current = false;
    setLoadingMore(false);
  }, [items.length]);

  const jumpTo = (target: number) => {
    setSheet(false);
    if (items.length <= target) {
      // Metadata is cheap, the feed only mounts the target window.
      setItems((prev) => [...prev, ...makePage(prev.length, target + 20 - prev.length, prefix)]);
      requestAnimationFrame(() => ref.current?.scrollToIndex(target, false));
    } else {
      ref.current?.scrollToIndex(target, false);
    }
  };

  const onLike = useCallback((id: string, force?: boolean) => {
    setLiked((prev) => {
      if (force && prev.has(id)) return prev;
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onRetry = useCallback(() => {
    setErrors((prev) => {
      const next = { ...prev };
      if (playback) delete next[playback.itemId];
      return next;
    });
    ref.current?.retry();
  }, [playback]);

  const onTogglePlay = useCallback(() => {
    if (playback?.state === 'paused') ref.current?.play();
    else ref.current?.pause();
  }, [playback]);

  const { show: showToast } = toast;
  const renderOverlay = useCallback(
    ({ item, index: i, isActive }: RenderOverlayInfo<FeedItem>) => (
      <FeedOverlay
        variant={preset.overlay === 'minimal' ? 'minimal' : 'full'}
        item={item}
        index={i}
        isActive={isActive}
        liked={liked.has(item.id)}
        muted={muted}
        dimmed={scrubbing}
        state={isActive && playback?.itemId === item.id ? playback.state : undefined}
        error={errors[item.id]}
        onLike={onLike}
        onComment={() => showToast('Comments are not part of this demo')}
        onShare={() => showToast('Link copied')}
        onToggleMute={() => setMuted((m) => !m)}
        onTogglePlay={onTogglePlay}
        onRetry={onRetry}
      />
    ),
    [preset.overlay, liked, muted, scrubbing, playback, errors, onLike, onRetry, onTogglePlay, showToast]
  );

  return (
    <View style={styles.root}>
      <InfiniteMediaFeed
        ref={ref}
        data={items}
        initialIndex={START_INDEX}
        active={active}
        muted={muted}
        horizontal={preset.horizontal}
        resizeMode={preset.resizeMode}
        backgroundColor={preset.background}
        diagnostics={diagnostics}
        scrubber={
          preset.scrubber === false
            ? undefined
            : preset.pinTop
              ? { top: insets.top + 52, ...preset.scrubber }
              : { bottom: insets.bottom + 8, ...preset.scrubber }
        }
        renderOverlay={preset.overlay === 'none' ? undefined : renderOverlay}
        onEndReached={loadMore}
        onIndexChange={({ index: i }) => setIndex(i)}
        onPlaybackStateChange={(e) => {
          setPlayback(e);
          if (e.state === 'playing') {
            setErrors((prev) => {
              if (!prev[e.itemId]) return prev;
              const next = { ...prev };
              delete next[e.itemId];
              return next;
            });
          }
        }}
        onScrubStart={() => {
          setScrubbing(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
        }}
        onScrubEnd={() => {
          setScrubbing(false);
          Haptics.selectionAsync();
        }}
        onError={(e) => setErrors((prev) => ({ ...prev, [e.itemId]: e }))}
        onMetrics={setMetrics}
      />

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.55)', 'transparent']}
        style={[styles.topShade, { height: insets.top + 96 }]}
      />
      <View style={[styles.header, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <GlassButton icon="chevron-back" accessibilityLabel="Back" onPress={onBack} />
        <View style={[styles.titleBlock, { top: insets.top + 4 }]} pointerEvents="none">
          <Text style={styles.title}>{presetId ? preset.title : title}</Text>
          <Text style={styles.subtitle}>
            {index + 1} of {items.length}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <GlassButton
            icon="pulse"
            active={diagnostics}
            accessibilityLabel="Diagnostics"
            onPress={() => setDiagnostics((d) => !d)}
          />
          <GlassButton icon="ellipsis-horizontal" accessibilityLabel="Controls" onPress={() => setSheet(true)} />
        </View>
      </View>

      {loadingMore ? (
        <View style={[styles.pill, { top: insets.top + 56 }]} pointerEvents="none">
          <Text style={styles.pillText}>Loading more</Text>
        </View>
      ) : null}

      {diagnostics ? (
        <View style={[styles.hud, { top: insets.top + 56 }]} pointerEvents="none">
          <StatGrid stats={metricsStats(metrics)} />
        </View>
      ) : null}

      <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toast.opacity, bottom: insets.bottom + 120 }]}>
        <Text style={styles.toastText}>{toast.message}</Text>
      </Animated.View>

      <Sheet visible={sheet} title="Controls" onClose={() => setSheet(false)}>
        <ActionSection title="Playback">
          <ActionRow icon="play" label="Play" onPress={() => { setSheet(false); ref.current?.play(); }} />
          <ActionRow icon="refresh" label="Restart video" onPress={() => { setSheet(false); ref.current?.seekTo(0); ref.current?.play(); }} />
          <ActionRow icon="volume-mute" label="Muted" toggle={{ value: muted, onChange: setMuted }} />
        </ActionSection>
        <ActionSection title="Navigate" note="Jumping far only mounts the target window, the items in between are never loaded.">
          <ActionRow icon="arrow-down" label="Next item" onPress={() => { setSheet(false); ref.current?.scrollToIndex(index + 1); }} />
          <ActionRow icon="play-skip-forward" label="Skip 10" onPress={() => jumpTo(index + 10)} />
          <ActionRow icon="rocket" label="Jump to #500" onPress={() => jumpTo(499)} />
          <ActionRow icon="arrow-up" label="Back to top" onPress={() => { setSheet(false); ref.current?.scrollToIndex(0, false); }} />
        </ActionSection>
        <ActionSection title="Feed data" note="Replacing keeps the current item playing when it's still in the new list.">
          <ActionRow
            icon="shuffle"
            label="Replace data"
            onPress={() => {
              setSheet(false);
              setItems(makePage(0, 20, `${prefix}-r${Date.now() % 1000}`));
              setErrors({});
            }}
          />
          {onOpenNested ? (
            <ActionRow icon="layers" label="Open another feed" detail="This one goes inactive underneath" onPress={() => { setSheet(false); onOpenNested(); }} />
          ) : null}
        </ActionSection>
        <ActionSection title="Developer">
          <ActionRow icon="pulse" label="Diagnostics overlay" toggle={{ value: diagnostics, onChange: setDiagnostics }} />
        </ActionSection>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  topShade: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Centered on the screen, not on the gap left between the buttons.
  titleBlock: { position: 'absolute', left: 0, right: 0, height: 38, alignItems: 'center', justifyContent: 'center' },
  title: { color: color.text, fontSize: 17, fontWeight: '700', ...textShadow },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontVariant: ['tabular-nums'], ...textShadow },
  headerRight: { flexDirection: 'row', gap: 8 },
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: color.glassStrong,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  pillText: { color: color.text, fontSize: 13, fontWeight: '500' },
  hud: { position: 'absolute', left: 12, right: 72 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: color.raised,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
  },
  toastText: { color: color.text, fontSize: 14, fontWeight: '500' },
});
