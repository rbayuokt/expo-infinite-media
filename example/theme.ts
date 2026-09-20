import { Platform } from 'react-native';

/** Ink and lime. Media is the colour, the chrome stays out of its way. */
export const color = {
  bg: '#07070B',
  surface: '#121219',
  raised: '#1B1B25',
  line: 'rgba(255,255,255,0.08)',
  text: '#F4F4F6',
  muted: '#9A9AA8',
  faint: '#5C5C6B',
  lime: '#C8FF3D',
  onLime: '#0B0B0F',
  violet: '#8B6CFF',
  coral: '#FF5A5F',
  amber: '#FFB547',
  sky: '#4CC9F0',
  heart: '#FF3B5C',
  glass: 'rgba(10,10,14,0.45)',
  glassStrong: 'rgba(10,10,14,0.72)',
};

export const font = {
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
};

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };

/** Keeps white text readable over bright video. */
export const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.5)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
};

/** Small uppercase section label. */
export const eyebrow = {
  color: '#9A9AA8',
  fontSize: 11,
  fontWeight: '700' as const,
  letterSpacing: 1.4,
  textTransform: 'uppercase' as const,
};
