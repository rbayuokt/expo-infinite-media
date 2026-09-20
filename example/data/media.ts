import type { InfiniteMediaItem } from '@rbayuokt/expo-infinite-media';

export type FeedItem = InfiniteMediaItem & {
  author: string;
  caption: string;
  likes: number;
};

const PORTRAIT = ['34487', '39767', '1164', '5271', '39875', '34560', '34426', '34452', '34421'];
const LANDSCAPE = ['42298', '43042', '45178', '46218', '47583', '48568', '49138', '4883', '3021'];
const PHOTOS = [1015, 1016, 1018, 1019, 1022, 1025, 1035, 1036, 1039, 1043, 1044, 1050];

// ImageKit resizes once and serves from the edge, and f-auto sends WebP where it's supported.
// The blurred 32px version is about 400 bytes, so it lands almost immediately.
const IMAGEKIT = 'https://ik.imagekit.io/rb4cxb5f5/benchmark-stuffs';
const photo = (id: number) => `${IMAGEKIT}/photo-${id}.jpg?tr=w-1080,h-1920,fo-auto,q-80,f-auto`;
const photoPoster = (id: number) => `${IMAGEKIT}/photo-${id}.jpg?tr=w-32,h-56,bl-10,q-40,f-auto`;
/** Full size source, so the downsampling path stays on show. */
const hugePhoto = (id: number) => `${IMAGEKIT}/photo-${id}.jpg?tr=w-3000,h-4500,fo-auto,q-90`;

const AUTHORS = ['mara.films', 'tokyo_nights', 'lensbyleo', 'riverside', 'nordic.trail', 'amelie'];
const CAPTIONS = [
  'Golden hour never gets old',
  'Shot on a rainy Tuesday',
  'Slow mornings',
  'Somewhere between here and there',
  'First try, no edits',
  'This view though',
];

const mixkit = (id: string, q: 720 | 1080) => `https://assets.mixkit.co/videos/${id}/${id}-${q}.mp4`;
const poster = (id: string) => `https://assets.mixkit.co/videos/${id}/${id}-thumb-720-0.jpg`;

/** Deterministic item for any index, so 1000+ items cost nothing to generate. */
export function makeItem(index: number, prefix = 'feed'): FeedItem {
  const id = `${prefix}-${index}`;
  const author = AUTHORS[index % AUTHORS.length];
  const caption = CAPTIONS[index % CAPTIONS.length];
  const likes = (index * 7919 + 1287) % 50000;
  const base = { id, author, caption, likes };

  // Every 37th item is broken on purpose, to exercise errors and retry.
  if (index > 0 && index % 37 === 0) {
    return { ...base, type: 'video', uri: mixkit('99999999', 720), caption: 'This one fails to load' };
  }
  if (index > 0 && index % 41 === 0) {
    return { ...base, type: 'image', uri: `${IMAGEKIT}/does-not-exist.jpg`, caption: 'Broken image' };
  }
  if (index % 23 === 11) {
    return {
      ...base,
      type: 'video',
      uri: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      caption: 'HLS stream, no disk cache',
    };
  }
  switch (index % 5) {
    case 0:
    case 2: {
      const v = PORTRAIT[(index * 3) % PORTRAIT.length];
      return { ...base, type: 'video', uri: mixkit(v, index % 10 === 0 ? 1080 : 720), poster: poster(v) };
    }
    case 4: {
      const v = LANDSCAPE[index % LANDSCAPE.length];
      return { ...base, type: 'video', uri: mixkit(v, 720), poster: poster(v) };
    }
    default: {
      const p = PHOTOS[index % PHOTOS.length];
      // Every 19th photo is served at full size, so the downsampling path keeps being exercised.
      const oversized = index % 19 === 3;
      return {
        ...base,
        type: 'image',
        uri: oversized ? hugePhoto(p) : photo(p),
        poster: photoPoster(p),
        caption: oversized ? '3000x4500 source, downsampled to the screen' : caption,
      };
    }
  }
}

export function makePage(start: number, count: number, prefix?: string): FeedItem[] {
  return Array.from({ length: count }, (_, i) => makeItem(start + i, prefix));
}

/** Simulated backend page with latency. */
export function fetchPage(start: number, count: number): Promise<FeedItem[]> {
  return new Promise((resolve) => setTimeout(() => resolve(makePage(start, count)), 600));
}
