import { Ionicons } from '@expo/vector-icons';
import type { InfiniteMediaError, PlaybackState } from '@rbayuokt/expo-infinite-media';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { RailButton } from '../components/RailButton';
import { color, radius, textShadow } from '../theme';
import type { FeedItem } from '../data/media';

type Props = {
  /** `minimal` drops the action rail and the tag row. */
  variant?: 'full' | 'minimal';
  item: FeedItem;
  index: number;
  isActive: boolean;
  liked: boolean;
  muted: boolean;
  state?: PlaybackState;
  error?: InfiniteMediaError;
  /** Fades the chrome out while the seek bar is in use. */
  dimmed?: boolean;
  onLike: (id: string, force?: boolean) => void;
  onComment: () => void;
  onShare: () => void;
  onToggleMute: () => void;
  onTogglePlay: () => void;
  onRetry: () => void;
};

const DOUBLE_TAP_MS = 250;

const ERROR_COPY: Record<string, { icon: 'cloud-offline-outline' | 'alert-circle-outline' | 'film-outline'; title: string }> = {
  NETWORK_UNAVAILABLE: { icon: 'cloud-offline-outline', title: "You're offline" },
  TIMEOUT: { icon: 'cloud-offline-outline', title: 'The connection timed out' },
  HTTP_ERROR: { icon: 'alert-circle-outline', title: "This post couldn't be loaded" },
  SOURCE_NOT_FOUND: { icon: 'alert-circle-outline', title: 'This post is no longer available' },
  UNSUPPORTED_FORMAT: { icon: 'film-outline', title: "This video format isn't supported" },
};

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

/** Spinner only after a short wait, so fast starts don't flash one. */
function DelayedSpinner({ visible }: { visible: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!visible) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 350);
    return () => clearTimeout(t);
  }, [visible]);
  return show ? <ActivityIndicator style={styles.center} color={color.text} size="large" /> : null;
}

function HeartBurst({ x, y }: { x: number; y: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(anim, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 2, duration: 350, delay: 150, useNativeDriver: true }),
    ]).start();
  }, [anim]);
  const scale = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.4] });
  const opacity = anim.interpolate({ inputRange: [0, 0.2, 1, 2], outputRange: [0, 1, 1, 0] });
  const translateY = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, -60] });
  return (
    <Animated.View pointerEvents="none" style={[styles.burst, { left: x - 50, top: y - 50, opacity, transform: [{ scale }, { translateY }, { rotate: '-12deg' }] }]}>
      <Ionicons name="heart" size={100} color={color.heart} />
    </Animated.View>
  );
}

export const FeedOverlay = memo(function FeedOverlay(props: Props) {
  const { item, index, isActive, liked, muted, state, error, dimmed, variant = 'full' } = props;
  const full = variant === 'full';
  const insets = useSafeAreaInsets();
  const lastTap = useRef(0);
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bursts, setBursts] = useState<{ key: number; x: number; y: number }[]>([]);
  const chrome = useRef(new Animated.Value(1)).current;
  const isVideo = item.type === 'video';

  useEffect(() => {
    Animated.timing(chrome, { toValue: dimmed ? 0 : 1, duration: 160, useNativeDriver: true }).start();
  }, [dimmed, chrome]);

  useEffect(() => () => {
    if (singleTap.current) clearTimeout(singleTap.current);
  }, []);

  const onTap = (e: GestureResponderEvent) => {
    const now = Date.now();
    const { locationX: x, locationY: y } = e.nativeEvent;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      // Double tap: like, never unlike, same as the apps people know.
      if (singleTap.current) clearTimeout(singleTap.current);
      singleTap.current = null;
      lastTap.current = 0;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setBursts((b) => [...b.slice(-3), { key: now, x, y }]);
      props.onLike(item.id, true);
      return;
    }
    lastTap.current = now;
    if (!isVideo) return;
    singleTap.current = setTimeout(() => {
      singleTap.current = null;
      props.onTogglePlay();
    }, DOUBLE_TAP_MS);
  };

  const copy = error ? ERROR_COPY[error.code] ?? { icon: 'alert-circle-outline' as const, title: 'Something went wrong' } : null;
  const loading = isActive && isVideo && !error && (state === 'preparing' || state === 'buffering' || state === 'poster');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={styles.tapArea} onPress={onTap} accessibilityLabel="Double tap to like" />

      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.55)']} style={styles.gradient} />

      <DelayedSpinner visible={loading} />
      {isActive && state === 'paused' && !dimmed ? (
        <View pointerEvents="none" style={[styles.center, styles.playBadge]}>
          <Ionicons name="play" size={44} color="rgba(255,255,255,0.9)" style={{ marginLeft: 6 }} />
        </View>
      ) : null}

      {error && copy ? (
        <View style={styles.errorCard}>
          <Ionicons name={copy.icon} size={40} color={color.text} />
          <Text style={styles.errorTitle}>{copy.title}</Text>
          <Text style={styles.errorCode}>
            {error.code}
            {error.httpStatus ? ` · HTTP ${error.httpStatus}` : ''}
          </Text>
          {error.recoverable ? (
            <View style={styles.retrying}>
              <ActivityIndicator color={color.muted} size="small" />
              <Text style={styles.retryingText}>Retrying, attempt {error.attempt}</Text>
            </View>
          ) : (
            <Button label="Try again" onPress={props.onRetry} />
          )}
        </View>
      ) : null}

      {bursts.map((b) => (
        <HeartBurst key={b.key} x={b.x} y={b.y} />
      ))}

      {full ? (
        <Animated.View style={[styles.rail, { bottom: insets.bottom + 68, opacity: chrome }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.author[0]?.toUpperCase()}</Text>
          <View style={styles.follow}>
            <Ionicons name="add" size={12} color="#FFFFFF" />
          </View>
        </View>
        <RailButton
          icon={liked ? 'heart' : 'heart-outline'}
          tint={liked ? color.heart : color.text}
          bumpKey={liked}
          label={compact(item.likes + (liked ? 1 : 0))}
          accessibilityLabel={liked ? 'Unlike' : 'Like'}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            props.onLike(item.id);
          }}
        />
        <RailButton icon="chatbubble-ellipses" label={compact(item.likes % 900)} accessibilityLabel="Comments" onPress={props.onComment} />
        <RailButton icon="arrow-redo" label="Share" accessibilityLabel="Share" onPress={props.onShare} />
          {isVideo ? (
            <RailButton
              icon={muted ? 'volume-mute' : 'volume-high'}
              accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              onPress={props.onToggleMute}
            />
          ) : null}
        </Animated.View>
      ) : null}

      <Animated.View
        style={[styles.meta, { bottom: insets.bottom + 58, right: full ? 84 : 16, opacity: chrome }]}
        pointerEvents="none">
        <Text style={styles.author}>@{item.author}</Text>
        <Text style={styles.caption} numberOfLines={2}>
          {item.caption}
        </Text>
        {full ? (
          <View style={styles.tags}>
            <View style={styles.tag}>
              <Ionicons name={isVideo ? 'videocam' : 'image'} size={11} color={color.text} />
              <Text style={styles.tagText}>{isVideo ? 'Video' : 'Photo'}</Text>
            </View>
            <Text style={styles.index}>#{index + 1}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Stops short of the bottom so the feed's seek bar keeps its own touches.
  tapArea: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 48 },
  gradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%' },
  center: { position: 'absolute', alignSelf: 'center', top: '45%' },
  playBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    marginTop: -10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  burst: { position: 'absolute', width: 100, height: 100 },
  rail: { position: 'absolute', right: 10, alignItems: 'center', gap: 20 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.violet,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  follow: {
    position: 'absolute',
    bottom: -9,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.heart,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { position: 'absolute', left: 16, right: 84, gap: 4 },
  author: { color: color.text, fontWeight: '700', fontSize: 16, ...textShadow },
  caption: { color: color.text, fontSize: 14, lineHeight: 19, ...textShadow },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  tagText: { color: color.text, fontSize: 11, fontWeight: '600' },
  index: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontVariant: ['tabular-nums'] },
  errorCard: {
    position: 'absolute',
    top: '32%',
    left: 40,
    right: 40,
    backgroundColor: 'rgba(28,28,30,0.92)',
    padding: 24,
    borderRadius: radius.lg,
    alignItems: 'center',
    gap: 8,
  },
  errorTitle: { color: color.text, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  errorCode: { color: color.muted, fontSize: 12, marginBottom: 8 },
  retrying: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46 },
  retryingText: { color: color.muted, fontSize: 14 },
});
