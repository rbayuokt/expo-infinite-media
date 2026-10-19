import React, { useEffect, useRef } from 'react';

import type { ResizeMode } from '../types';
import type { VideoPool } from './pool';

type Props = {
  itemId: string;
  uri: string;
  poster?: string;
  isVideo: boolean;
  /** Current, prepared or neither. Only the current one plays. */
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

/**
 * One page's media. The poster is an `<img>` that sits on top until the video has a frame,
 * which is the same trick the native slots use.
 */
export function Slot(props: Props) {
  const { itemId, uri, poster, isVideo, role, pool, resizeMode, muted, loop, autoplay, keep } =
    props;
  const host = useRef<HTMLDivElement | null>(null);
  const cover = useRef<HTMLImageElement | null>(null);
  const became = useRef(0);

  useEffect(() => {
    if (!isVideo || role === 'none' || !host.current) {
      // A page that left the window keeps its element until the pool reuses it, so it has
      // to be stopped here. Otherwise a jump leaves the old video playing off screen.
      pool.find(itemId)?.el.pause();
      return;
    }
    // play() settles a tick later. By then this page can already be gone, and the retry
    // below would start an element that no longer belongs to anyone.
    let cancelled = false;
    const slot = pool.take(itemId, keep);
    const el = slot.el;
    slot.itemId = itemId;
    // Startup is counted from becoming current, the way the phones count it. A post that
    // is only being prepared is downloading in the background and nobody is waiting on it.
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

    // Only the post you are looking at reports state, so a neighbour filling its buffer
    // cannot put a spinner on screen or count as a stall.
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
        // Browsers refuse autoplay with sound until the page has been touched, so fall
        // back to a muted start and let the first gesture turn the sound back on.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
