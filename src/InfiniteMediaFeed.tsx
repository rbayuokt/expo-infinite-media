import { useEventListener } from 'expo';
import { useReleasingSharedObject } from 'expo-modules-core';
import {
  createElement,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import Native, { toNativeItem, type FeedSession, type NativeItem } from './ExpoInfiniteMediaModule';
import { MediaSlotView } from './MediaSlotView';
import { diffItems, duplicateIds } from './core/diff';
import { clampIndex, mountWindow, shouldFireEndReached } from './core/window';
import { createProgressStore, useProgressSnapshot, type ProgressStore } from './scrubber/store';
import type {
  InfiniteMediaFeedProps,
  InfiniteMediaFeedRef,
  InfiniteMediaItem,
  RenderOverlayInfo,
  ResizeMode,
  ScrubberOptions,
} from './types';

type ScrubberComponent = typeof import('./scrubber/MediaScrubber').MediaScrubber;

let scrubberModule: ScrubberComponent | null | undefined;

/** Loaded on demand: apps that don't use the scrubber don't need Reanimated. */
function loadScrubber(): ScrubberComponent | null {
  if (scrubberModule !== undefined) return scrubberModule;
  try {
    scrubberModule = require('./scrubber/MediaScrubber').MediaScrubber as ScrubberComponent;
  } catch {
    scrubberModule = null;
    console.warn(
      '[expo-infinite-media] the scrubber needs react-native-reanimated and react-native-gesture-handler. Install both, or drop the scrubber prop.'
    );
  }
  return scrubberModule;
}

type ScrubberLayerProps = {
  store: ProgressStore;
  options: ScrubberOptions;
  onSeek: (seconds: number, precise: boolean) => void;
  onScrubStart: () => void;
  onScrubEnd: (seconds: number) => void;
};

/** Re-renders on progress events. The feed and the overlays don't. */
function ScrubberLayer({ store, options, onSeek, onScrubStart, onScrubEnd }: ScrubberLayerProps) {
  const Scrubber = loadScrubber();
  const p = useProgressSnapshot(store);
  if (!Scrubber || !p.itemId || p.duration <= 0) return null;
  const inset = options.horizontalInset ?? 12;
  const place = options.top != null ? { top: options.top } : { bottom: options.bottom ?? 0 };
  return (
    <View style={[styles.scrubber, place, { left: inset, right: inset }]}>
      {createElement(Scrubber, {
        hidden: p.scrolling && options.hideWhileScrolling !== false,
        position: p.position,
        duration: p.duration,
        buffered: p.buffered,
        playing: p.playing,
        onSeek,
        onScrubStart,
        onScrubEnd,
        ...options,
      })}
    </View>
  );
}

type Size = { width: number; height: number };

type PageProps<T extends InfiniteMediaItem> = {
  item: T;
  index: number;
  isActive: boolean;
  size: Size;
  horizontal: boolean;
  session: FeedSession;
  resizeMode: ResizeMode;
  renderOverlay?: (info: RenderOverlayInfo<T>) => ReactNode;
};

function PageImpl<T extends InfiniteMediaItem>(props: PageProps<T>) {
  const { item, index, isActive, size, horizontal, session, resizeMode, renderOverlay } = props;
  const position = horizontal ? { left: index * size.width } : { top: index * size.height };
  return (
    <View style={[styles.page, size, position]} collapsable={false}>
      <MediaSlotView
        session={
          (session as unknown as { __expo_shared_object_id__: number }).__expo_shared_object_id__
        }
        itemId={item.id}
        resizeMode={resizeMode}
        style={StyleSheet.absoluteFill}
      />
      {renderOverlay ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {renderOverlay({ item, index, isActive })}
        </View>
      ) : null}
    </View>
  );
}

const Page = memo(PageImpl) as typeof PageImpl;

export function InfiniteMediaFeed<T extends InfiniteMediaItem>(
  props: InfiniteMediaFeedProps<T> & { ref?: Ref<InfiniteMediaFeedRef> }
) {
  const {
    data,
    renderOverlay,
    initialIndex = 0,
    horizontal = false,
    windowSize = 2,
    active = true,
    autoplay = true,
    loop = true,
    muted = false,
    resizeMode = 'cover',
    preload,
    resumeOnForeground = true,
    progressInterval = 0,
    diagnostics = false,
    onEndReachedThreshold = 3,
    scrubber,
    style,
    backgroundColor = '#000',
    ref,
  } = props;

  const session = useReleasingSharedObject(() => new Native.FeedSession(), []) as FeedSession;
  const scrollRef = useRef<ScrollView>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [index, setIndex] = useState(() => clampIndex(initialIndex, data.length));

  const indexRef = useRef(index);
  useLayoutEffect(() => {
    indexRef.current = index;
  }, [index]);
  const currentIdRef = useRef<string | undefined>(data[index]?.id);
  const endReachedAt = useRef(-1);

  const scrubberOptions: ScrubberOptions | null = useMemo(
    () => (scrubber ? (scrubber === true ? {} : scrubber) : null),
    [scrubber]
  );
  const progressStore = useMemo(() => createProgressStore(), []);
  const wasPlaying = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fades the scrubber out while the feed moves between pages, back in once it settles.
  const setScrolling = (scrolling: boolean) => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (scrolling) {
      progressStore.set({ scrolling: true });
      return;
    }
    // A lifted finger can still be followed by momentum, so wait a beat before fading back.
    settleTimer.current = setTimeout(() => progressStore.set({ scrolling: false }), 90);
  };

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    []
  );

  const nativeItems = useMemo(() => data.map(toNativeItem), [data]);
  const sentItems = useRef<NativeItem[]>([]);

  useLayoutEffect(() => {
    if (__DEV__) {
      const dups = duplicateIds(nativeItems);
      if (dups.length) console.warn(`[expo-infinite-media] duplicate item ids: ${dups.join(', ')}`);
    }
    const op = diffItems(sentItems.current, nativeItems);
    if (op.kind === 'append') session.appendItems(op.items);
    else if (op.kind === 'replace') session.setItems(op.items);
    sentItems.current = nativeItems;
  }, [nativeItems, session]);

  useEffect(() => {
    session.setConfig({
      active,
      autoplay,
      loop,
      muted,
      preloadAhead: preload?.ahead ?? 2,
      preloadBehind: preload?.behind ?? 1,
      resumeOnForeground,
      // The scrubber needs progress even when the app didn't ask for it.
      progressInterval:
        progressInterval > 0 ? Math.max(250, progressInterval) : scrubberOptions ? 250 : 0,
      diagnostics,
    });
  }, [
    session,
    active,
    autoplay,
    loop,
    muted,
    preload?.ahead,
    preload?.behind,
    resumeOnForeground,
    progressInterval,
    diagnostics,
    scrubberOptions,
  ]);

  const scrollTo = (target: number, animated: boolean) => {
    if (!size) return;
    const offset = horizontal ? target * size.width : target * size.height;
    scrollRef.current?.scrollTo(horizontal ? { x: offset, animated } : { y: offset, animated });
  };

  // Replacing data keeps the current item if it still exists, wherever it moved.
  useLayoutEffect(() => {
    const currentId = currentIdRef.current;
    if (data[index]?.id === currentId) return;
    const moved = currentId ? data.findIndex((it) => it.id === currentId) : -1;
    const next = moved >= 0 ? moved : clampIndex(index, data.length);
    endReachedAt.current = -1;
    currentIdRef.current = data[next]?.id;
    if (next !== index) {
      setIndex(next);
      scrollTo(next, false);
    }
  }, [data]);

  // Once per data length, so an append that doesn't move the index can fire it again.
  const { onEndReached } = props;
  useEffect(() => {
    if (
      shouldFireEndReached(index, data.length, onEndReachedThreshold) &&
      endReachedAt.current !== data.length
    ) {
      endReachedAt.current = data.length;
      onEndReached?.();
    }
  }, [index, data.length, onEndReachedThreshold, onEndReached]);

  // useEventListener always calls the latest closure, so these read current props.
  useEventListener(session, 'indexChange', ({ index: nativeIndex, itemId }) => {
    const at =
      data[nativeIndex]?.id === itemId ? nativeIndex : data.findIndex((it) => it.id === itemId);
    if (at < 0) return;
    currentIdRef.current = itemId;
    progressStore.reset(itemId);
    if (at !== index) setIndex(at);
    props.onIndexChange?.({ index: at, item: data[at] });
  });
  useEventListener(session, 'playbackStateChange', (e) => {
    progressStore.set({ itemId: e.itemId, playing: e.state === 'playing' });
    props.onPlaybackStateChange?.(e);
  });
  useEventListener(session, 'firstFrame', (e) => props.onFirstFrame?.(e));
  useEventListener(session, 'progress', (e) => {
    progressStore.set(e);
    props.onProgress?.(e);
  });
  useEventListener(session, 'error', (e) => props.onError?.(e));
  useEventListener(session, 'metrics', (e) => props.onMetrics?.(e));

  useImperativeHandle(
    ref,
    () => ({
      play: () => session.play(),
      pause: () => session.pause(),
      seekTo: (seconds) => session.seekTo(seconds),
      setMuted: (value) => session.setMuted(value),
      retry: () => session.retry(),
      scrollToIndex: (target, animated = true) => {
        const next = clampIndex(target, data.length);
        // Mount the target window before the scroll lands there.
        setIndex(next);
        scrollTo(next, animated);
      },
    }),
    [session, size, horizontal, data.length]
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) setSize({ width, height });
  };

  // Android ignores contentOffset on first layout, so place the initial page explicitly.
  // Rotation also lands here and keeps the same page.
  useLayoutEffect(() => {
    if (size) scrollTo(indexRef.current, false);
  }, [size, horizontal]);

  // Set once, when the size is first known. A contentOffset that tracks the index fights the
  // scroll view mid-deceleration and leaves it a few points off the page, so later moves go
  // through scrollTo instead.
  const [initialOffset, setInitialOffset] = useState<{ x: number; y: number } | undefined>();
  useLayoutEffect(() => {
    if (!size || initialOffset) return;
    const target = indexRef.current * (horizontal ? size.width : size.height);
    setInitialOffset(horizontal ? { x: target, y: 0 } : { x: 0, y: target });
  }, [size, horizontal, initialOffset]);

  const count = data.length;
  const pages = size ? mountWindow(index, windowSize, count) : [];
  const contentSize = size
    ? horizontal
      ? { width: count * size.width, height: size.height }
      : { width: size.width, height: count * size.height }
    : undefined;

  return (
    <View style={[styles.root, { backgroundColor }, style]} onLayout={onLayout}>
      {scrubberOptions ? (
        <ScrubberLayer
          store={progressStore}
          options={scrubberOptions}
          onSeek={(seconds, precise) => {
            session.seekTo(seconds, precise);
            const itemId = progressStore.get().itemId;
            progressStore.set({ position: seconds });
            if (itemId) props.onSeek?.({ itemId, position: seconds });
          }}
          onScrubStart={() => {
            const { itemId, playing } = progressStore.get();
            wasPlaying.current = playing;
            if (playing && (scrubberOptions.pauseWhileScrubbing ?? true)) session.pause();
            if (itemId) props.onScrubStart?.({ itemId });
          }}
          onScrubEnd={(seconds) => {
            if (wasPlaying.current && (scrubberOptions.pauseWhileScrubbing ?? true)) session.play();
            const itemId = progressStore.get().itemId;
            if (itemId) props.onScrubEnd?.({ itemId, position: seconds });
          }}
        />
      ) : null}
      {size ? (
        <ScrollView
          ref={scrollRef}
          horizontal={horizontal}
          pagingEnabled
          disableIntervalMomentum
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          scrollsToTop={false}
          overScrollMode="never"
          // iOS otherwise adds a safe-area inset here, which shifts every snap point and
          // leaves a strip of the next page showing.
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          onScrollBeginDrag={() => setScrolling(true)}
          onScrollEndDrag={() => setScrolling(false)}
          onMomentumScrollBegin={() => setScrolling(true)}
          onMomentumScrollEnd={() => setScrolling(false)}
          contentOffset={initialOffset}
          contentContainerStyle={contentSize}
          style={StyleSheet.absoluteFill}>
          {pages.map((i) => (
            <Page
              key={data[i].id}
              item={data[i]}
              index={i}
              isActive={i === index}
              size={size}
              horizontal={horizontal}
              session={session}
              resizeMode={resizeMode}
              renderOverlay={renderOverlay}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  page: { position: 'absolute' },
  // Above the pages, so the bar keeps its touches while the feed scrolls.
  scrubber: { position: 'absolute', zIndex: 2 },
});
