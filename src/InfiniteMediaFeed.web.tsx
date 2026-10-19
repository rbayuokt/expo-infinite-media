import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { clampIndex, mountWindow, shouldFireEndReached } from './core/window';
import type {
  InfiniteMediaFeedProps,
  InfiniteMediaFeedRef,
  InfiniteMediaItem,
  ScrubberOptions,
} from './types';
import { WebScrubber } from './web/Scrubber.web';
import { Slot } from './web/Slot.web';
import { WebMetrics } from './web/metrics';
import { VideoPool } from './web/pool';

const POOL_SIZE = 3;

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
    progressInterval = 0,
    diagnostics = false,
    scrubber,
    speed,
    style,
    onEndReachedThreshold = 3,
    backgroundColor = '#000',
    ref,
  } = props;

  const scroller = useRef<HTMLDivElement | null>(null);
  const pool = useMemo(() => new VideoPool(POOL_SIZE), []);
  const [index, setIndex] = useState(() => clampIndex(initialIndex, data.length));
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  const endReachedAt = useRef(-1);
  const rate = useRef(1);

  useEffect(() => () => pool.destroy(), [pool]);

  const metrics = useMemo(() => new WebMetrics(), []);
  useEffect(() => {
    if (!diagnostics || !props.onMetrics) return;
    const id = setInterval(() => props.onMetrics?.(metrics.sample(pool)), 2000);
    return () => clearInterval(id);
  }, [diagnostics, metrics, pool]);

  const scrubberOptions: ScrubberOptions | null = useMemo(
    () => (scrubber ? (scrubber === true ? {} : scrubber) : null),
    [scrubber]
  );
  const wasPlaying = useRef(false);

  const current = data[index];
  const pages = mountWindow(index, windowSize, data.length);
  const keep = useMemo(() => {
    const ids: string[] = [];
    for (const offset of [0, 1, -1]) {
      const item = data[index + offset];
      if (item) ids.push(item.id);
    }
    return ids;
  }, [data, index]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!best) return;
        const next = Number((best.target as HTMLElement).dataset.index);
        if (Number.isFinite(next) && next !== indexRef.current) {
          setIndex(next);
          const item = data[next];
          if (item) props.onIndexChange?.({ index: next, item });
        }
      },
      { root, threshold: [0.5, 0.75] }
    );
    root.querySelectorAll('[data-index]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [data, pages.join(',')]);

  useEffect(() => {
    if (
      endReachedAt.current !== data.length &&
      shouldFireEndReached(index, data.length, onEndReachedThreshold)
    ) {
      endReachedAt.current = data.length;
      props.onEndReached?.();
    }
  }, [index, data.length, onEndReachedThreshold]);

  useEffect(() => {
    if (!progressInterval || !current) return;
    const id = setInterval(
      () => {
        const el = pool.find(current.id)?.el;
        if (!el || !Number.isFinite(el.duration)) return;
        props.onProgress?.({
          itemId: current.id,
          position: el.currentTime,
          duration: el.duration,
          buffered: el.buffered.length ? el.buffered.end(el.buffered.length - 1) : el.currentTime,
        });
      },
      Math.max(250, progressInterval)
    );
    return () => clearInterval(id);
  }, [current?.id, progressInterval]);

  const scrollTo = useCallback(
    (target: number, animated = true) => {
      const root = scroller.current;
      if (!root) return;
      const size = horizontal ? root.clientWidth : root.clientHeight;
      root.scrollTo({
        [horizontal ? 'left' : 'top']: target * size,
        behavior: animated ? 'smooth' : 'auto',
      } as ScrollToOptions);
    },
    [horizontal]
  );

  const landed = useRef(false);
  useLayoutEffect(() => {
    if (landed.current || !scroller.current || !data.length) return;
    landed.current = true;
    const target = clampIndex(initialIndex, data.length);
    if (target > 0) scrollTo(target, false);
  }, [data.length]);

  const applyRate = useCallback(
    (value: number, rampMs: number) => {
      const el = current ? pool.find(current.id)?.el : undefined;
      rate.current = value;
      props.onRateChange?.({ rate: value });
      if (!el) return;
      const from = el.playbackRate;
      if (rampMs <= 0 || Math.abs(value - from) < 0.01) {
        el.playbackRate = value;
        return;
      }
      const started = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - started) / rampMs);
        el.playbackRate = from + (value - from) * t;
        if (t < 1 && rate.current === value) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    [current?.id]
  );

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const el = current ? pool.find(current.id)?.el : undefined;
        el?.play().catch(() => {});
      },
      pause: () => {
        const el = current ? pool.find(current.id)?.el : undefined;
        el?.pause();
      },
      seekTo: (seconds) => {
        const el = current ? pool.find(current.id)?.el : undefined;
        if (el) el.currentTime = Math.max(0, seconds);
      },
      setRate: (value, rampMs = 150) => applyRate(value, rampMs),
      setMuted: (value) => {
        const el = current ? pool.find(current.id)?.el : undefined;
        if (el) el.muted = value;
      },
      scrollToIndex: (target, animated = true) =>
        scrollTo(clampIndex(target, data.length), animated),
      retry: () => {
        const el = current ? pool.find(current.id)?.el : undefined;
        if (el) {
          el.load();
          el.play().catch(() => {});
        }
      },
    }),

    [current?.id, data.length, scrollTo, applyRate]
  );

  const speedOptions = speed ? (speed === true ? {} : speed) : null;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fast, setFast] = useState(false);
  const startHold = () => {
    if (!speedOptions) return;
    holdTimer.current = setTimeout(() => {
      setFast(true);
      applyRate(speedOptions.rate ?? 2, speedOptions.rampMs ?? 150);
    }, speedOptions.holdDelay ?? 250);
  };
  const endHold = () => {
    if (!speedOptions) return;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (!fast) return;
    setFast(false);
    applyRate(1, speedOptions.rampMs ?? 150);
  };

  const onPointerDown = () => {
    if (!muted) {
      const el = current ? pool.find(current.id)?.el : undefined;
      if (el?.muted) {
        el.muted = false;
        el.play().catch(() => {});
      }
    }
    startHold();
  };

  useEffect(() => {
    if (!active) {
      const el = current ? pool.find(current.id)?.el : undefined;
      el?.pause();
    }
  }, [active, current?.id]);

  return (
    <View
      style={[styles.root, { backgroundColor }, style]}
      onPointerDown={onPointerDown}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onPointerLeave={endHold}>
      <div
        ref={scroller}
        style={{
          position: 'absolute',
          inset: 0,
          overflowX: horizontal ? 'auto' : 'hidden',
          overflowY: horizontal ? 'hidden' : 'auto',
          scrollSnapType: `${horizontal ? 'x' : 'y'} mandatory`,
          display: horizontal ? 'flex' : 'block',
          scrollbarWidth: 'none',
        }}>
        {data.map((item, i) => {
          const mounted = pages.includes(i);
          const role = i === index ? 'current' : keep.includes(item.id) ? 'prepared' : 'none';
          return (
            <div
              key={item.id}
              data-index={i}
              style={{
                position: 'relative',
                width: horizontal ? '100%' : undefined,
                height: '100%',
                flex: horizontal ? '0 0 100%' : undefined,
                scrollSnapAlign: 'start',
                scrollSnapStop: 'always',
                background: backgroundColor,
              }}>
              {mounted ? (
                <>
                  <Slot
                    itemId={item.id}
                    uri={item.uri}
                    poster={item.poster}
                    isVideo={item.type === 'video'}
                    role={active ? role : 'none'}
                    pool={pool}
                    resizeMode={resizeMode}
                    muted={muted}
                    loop={loop}
                    autoplay={autoplay}
                    keep={keep}
                    onFirstFrame={(itemId, startupMs) => {
                      metrics.firstFrame(startupMs);
                      props.onFirstFrame?.({ itemId, startupMs, fromCache: false });
                    }}
                    onState={(itemId, state) => {
                      metrics.state(itemId, state);
                      props.onPlaybackStateChange?.({
                        itemId,
                        state: state as never,
                      });
                    }}
                    onError={(itemId, message) => {
                      metrics.error();
                      props.onError?.({
                        itemId,
                        code: 'PLAYBACK_FAILED',
                        message,
                        recoverable: true,
                        attempt: 1,
                      } as never);
                    }}
                  />
                  {renderOverlay ? (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'box-none' as never,
                      }}>
                      {renderOverlay({ item, index: i, isActive: i === index })}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {scrubberOptions ? (
        <WebScrubber
          options={scrubberOptions}
          hidden={false}
          element={() => (current ? pool.find(current.id)?.el : undefined)}
          onSeek={(secs) => {
            const el = current ? pool.find(current.id)?.el : undefined;
            if (el) el.currentTime = Math.max(0, secs);
            if (current) props.onSeek?.({ itemId: current.id, position: secs });
          }}
          onScrubStart={() => {
            const el = current ? pool.find(current.id)?.el : undefined;
            wasPlaying.current = !!el && !el.paused;
            if (el && (scrubberOptions.pauseWhileScrubbing ?? true)) el.pause();
            if (current) props.onScrubStart?.({ itemId: current.id });
          }}
          onScrubEnd={(secs) => {
            const el = current ? pool.find(current.id)?.el : undefined;
            if (el && wasPlaying.current && (scrubberOptions.pauseWhileScrubbing ?? true)) {
              el.play().catch(() => {});
            }
            if (current) props.onScrubEnd?.({ itemId: current.id, position: secs });
          }}
        />
      ) : null}
      {speedOptions && fast && (speedOptions.showIndicator ?? true) ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: speedOptions.bottom ?? 24,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
          <div
            style={{
              padding: '5px 14px',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
            }}>
            {(speedOptions.label ?? ((r: number) => `${r}x`))(speedOptions.rate ?? 2)}
          </div>
        </div>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, position: 'relative' },
  scrubber: { position: 'absolute', zIndex: 2 },
});
