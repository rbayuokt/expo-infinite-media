import React, { useEffect, useRef } from 'react';

import type { ResizeMode } from '../types';
import type { VideoPool } from './pool';

type Props = {
  itemId: string;
  uri: string;
  poster?: string;
  isVideo: boolean;
  role: 'current' | 'prepared' | 'none';
  pool: VideoPool;
  resizeMode: ResizeMode;
  muted: boolean;
  loop: boolean;
  autoplay: boolean;
  keep: readonly string[];
  onFirstFrame: (itemId: string, startupMs: number) => void;
  onState: (itemId: string, state: string) => void;
  onError: (itemId: string, message: string) => void;
};

export function Slot(props: Props) {
  const { itemId, uri, poster, isVideo, role, pool, resizeMode, muted, loop, autoplay, keep } =
    props;
  const host = useRef<HTMLDivElement | null>(null);
  const cover = useRef<HTMLImageElement | null>(null);
  const became = useRef(0);

  useEffect(() => {
    if (!isVideo || role === 'none' || !host.current) {
      pool.find(itemId)?.el.pause();
      return;
    }
    let cancelled = false;
    const slot = pool.take(itemId, keep);
    const el = slot.el;
    slot.itemId = itemId;
    if (role === 'current') became.current = performance.now();

    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: resizeMode === 'contain' ? 'contain' : 'cover',
    } as Partial<CSSStyleDeclaration>);
    el.muted = muted;
    el.loop = loop;
    el.playsInline = true;
    if (el.getAttribute('src') !== uri) {
      el.src = uri;
      el.load();
    }
    host.current.insertBefore(el, host.current.firstChild);

    const report = (state: string) => {
      if (role === 'current') props.onState(itemId, state);
    };
    const showVideo = () => {
      if (cover.current) cover.current.style.opacity = '0';
      if (role === 'current') {
        props.onFirstFrame(itemId, Math.max(0, performance.now() - became.current));
      }
    };
    const onPlaying = () => {
      report('playing');
      showVideo();
    };
    const onWaiting = () => report('buffering');
    const onPause = () => report('paused');
    const onLoaded = () => {
      report('ready');
      if (role !== 'current') showVideo();
    };
    const onFail = () => props.onError(itemId, el.error?.message ?? 'playback failed');

    el.addEventListener('playing', onPlaying);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('pause', onPause);
    el.addEventListener('loadeddata', onLoaded);
    el.addEventListener('error', onFail);

    if (role === 'current' && autoplay) {
      report('preparing');
      el.play().catch(() => {
        if (cancelled) return;
        if (el.muted) return report('paused');
        el.muted = true;
        el.play().catch(() => {
          if (!cancelled) report('paused');
        });
      });
    } else {
      el.pause();
    }

    return () => {
      cancelled = true;
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('loadeddata', onLoaded);
      el.removeEventListener('error', onFail);
      el.pause();
      if (el.parentElement === host.current) host.current?.removeChild(el);
    };
  }, [itemId, uri, isVideo, role, resizeMode, muted, loop, autoplay]);

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0, background: '#000' }}>
      {poster || !isVideo ? (
        <img
          ref={cover}
          src={isVideo ? poster : uri}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: resizeMode === 'contain' ? 'contain' : 'cover',
            opacity: 1,
            transition: 'opacity 120ms linear',
          }}
        />
      ) : null}
    </div>
  );
}
