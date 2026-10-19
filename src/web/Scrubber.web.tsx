import React, { useEffect, useRef, useState } from 'react';

import type { ScrubberOptions } from '../types';

type Props = {
  options: ScrubberOptions;
  hidden: boolean;
  /** Reads straight off the element, so the bar never waits on React state. */
  element: () => HTMLVideoElement | undefined;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: (seconds: number) => void;
};

const clock = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * The web seek bar. Reanimated's frame callback does not run here, so the native scrubber
 * would render but never move. This one animates from `requestAnimationFrame` and writes
 * widths straight to the DOM, which keeps React out of the per-frame path the same way.
 */
export function WebScrubber({ options, hidden, element, onSeek, onScrubStart, onScrubEnd }: Props) {
  const height = options.height ?? 3;
  const expanded = options.expandedHeight ?? 8;
  const inset = options.horizontalInset ?? 12;
  const colors = options.colors ?? {};
  const track = useRef<HTMLDivElement | null>(null);
  const fill = useRef<HTMLDivElement | null>(null);
  const buffered = useRef<HTMLDivElement | null>(null);
  const thumb = useRef<HTMLDivElement | null>(null);
  const label = useRef<HTMLDivElement | null>(null);
  const [held, setHeld] = useState(false);
  const holding = useRef(false);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = element();
      if (el && Number.isFinite(el.duration) && el.duration > 0 && !holding.current) {
        const ratio = Math.min(1, el.currentTime / el.duration);
        if (fill.current) fill.current.style.width = `${ratio * 100}%`;
        if (thumb.current) thumb.current.style.left = `${ratio * 100}%`;
        if (buffered.current && el.buffered.length) {
          const end = el.buffered.end(el.buffered.length - 1);
          buffered.current.style.width = `${Math.min(1, end / el.duration) * 100}%`;
        }
        if (label.current) label.current.textContent = `${clock(el.currentTime)} / ${clock(el.duration)}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [element]);

  const seconds = (clientX: number) => {
    const el = element();
    const box = track.current?.getBoundingClientRect();
    if (!el || !box || !Number.isFinite(el.duration)) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    if (fill.current) fill.current.style.width = `${ratio * 100}%`;
    if (thumb.current) thumb.current.style.left = `${ratio * 100}%`;
    return ratio * el.duration;
  };

  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    holding.current = true;
    setHeld(true);
    onScrubStart();
    onSeek(seconds(e.clientX));
  };
  const move = (e: React.PointerEvent) => {
    if (!holding.current) return;
    e.stopPropagation();
    onSeek(seconds(e.clientX));
  };
  const up = (e: React.PointerEvent) => {
    if (!holding.current) return;
    e.stopPropagation();
    holding.current = false;
    setHeld(false);
    onScrubEnd(seconds(e.clientX));
  };

  const bar = held ? expanded : height;
  const place = options.top != null ? { top: options.top } : { bottom: options.bottom ?? 0 };

  return (
    <div
      style={{
        position: 'absolute',
        left: inset,
        right: inset,
        ...place,
        paddingTop: 14,
        paddingBottom: 14,
        opacity: hidden && options.hideWhileScrolling !== false ? 0 : 1,
        transition: 'opacity 160ms linear',
        touchAction: 'none',
        zIndex: 2,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}>
      {options.showTime !== false && held ? (
        <div
          ref={label}
          style={{
            position: 'absolute',
            bottom: bar + 18,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: colors.time ?? '#fff',
            fontSize: 12,
            fontVariantNumeric: 'tabular-nums',
          }}
        />
      ) : null}
      <div
        ref={track}
        style={{
          position: 'relative',
          height: bar,
          borderRadius: bar,
          background: colors.track ?? 'rgba(255,255,255,0.25)',
          transition: 'height 120ms ease',
        }}>
        <div
          ref={buffered}
          style={{
            position: 'absolute',
            inset: 0,
            width: '0%',
            borderRadius: bar,
            background: colors.buffered ?? 'rgba(255,255,255,0.4)',
          }}
        />
        <div
          ref={fill}
          style={{
            position: 'absolute',
            inset: 0,
            width: '0%',
            borderRadius: bar,
            background: colors.fill ?? '#fff',
          }}
        />
        {(options.thumbSize ?? 14) > 0 && held ? (
          <div
            ref={thumb}
            style={{
              position: 'absolute',
              top: '50%',
              left: '0%',
              width: options.thumbSize ?? 14,
              height: options.thumbSize ?? 14,
              marginLeft: -(options.thumbSize ?? 14) / 2,
              marginTop: -(options.thumbSize ?? 14) / 2,
              borderRadius: 999,
              background: colors.thumb ?? '#fff',
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
