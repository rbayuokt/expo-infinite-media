import type { ResizeMode, ScrubberOptions } from '@rbayuokt/expo-infinite-media';

import type { IconName } from '../components/icons';
import { color } from '../theme';

/** How much chrome the overlay draws. `none` passes no renderOverlay at all. */
export type OverlayVariant = 'full' | 'minimal' | 'none';

export type FeedPreset = {
  id: string;
  title: string;
  subtitle: string;
  icon: IconName;
  accent: string;
  overlay: OverlayVariant;
  /** false leaves the seek bar out entirely. */
  scrubber: false | ScrubberOptions;
  resizeMode?: ResizeMode;
  horizontal?: boolean;
  /** Puts the seek bar under the header instead of at the bottom. */
  pinTop?: boolean;
  muted?: boolean;
  background?: string;
};

/** Same feed component every time, only props differ. */
export const PRESETS: FeedPreset[] = [
  {
    id: 'classic',
    title: 'Classic',
    subtitle: 'Action rail, captions, thin seek bar',
    icon: 'play-circle',
    accent: color.lime,
    overlay: 'full',
    scrubber: { colors: { fill: color.lime, thumb: color.lime, time: color.text } },
  },
  {
    id: 'minimal',
    title: 'Minimal',
    subtitle: 'Caption only, chunky bar, no thumb or clock',
    icon: 'remove-outline',
    accent: color.text,
    overlay: 'minimal',
    scrubber: { height: 6, expandedHeight: 14, thumbSize: 0, showTime: false, horizontalInset: 0 },
  },
  {
    id: 'cinema',
    title: 'Cinema',
    subtitle: 'Letterboxed and muted, amber bar',
    icon: 'film-outline',
    accent: color.amber,
    overlay: 'minimal',
    resizeMode: 'contain',
    muted: true,
    background: '#000000',
    scrubber: {
      height: 2,
      expandedHeight: 10,
      thumbSize: 10,
      colors: { fill: color.amber, thumb: color.amber, buffered: 'rgba(255,181,71,0.35)' },
    },
  },
  {
    id: 'stories',
    title: 'Stories',
    subtitle: 'Horizontal paging, bar pinned to the top',
    icon: 'albums-outline',
    accent: color.violet,
    overlay: 'minimal',
    horizontal: true,
    pinTop: true,
    scrubber: {
      height: 4,
      expandedHeight: 10,
      thumbSize: 0,
      showTime: false,
      colors: { fill: color.violet, buffered: 'rgba(139,108,255,0.35)' },
    },
  },
  {
    id: 'bare',
    title: 'Bare',
    subtitle: 'Just the media, no overlay and no bar',
    icon: 'square-outline',
    accent: color.faint,
    overlay: 'none',
    scrubber: false,
  },
];

export const presetById = (id?: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
