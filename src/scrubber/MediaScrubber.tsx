/* eslint-disable react-hooks/immutability -- Reanimated shared values are written from
   worklets (gesture, frame and layout callbacks) by design. The React Compiler rule can't
   see that those run off the render path. */
import {
  StyleSheet,
  TextInput,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export type MediaScrubberColors = {
  track?: string;
  buffered?: string;
  fill?: string;
  thumb?: string;
  time?: string;
};

export type MediaScrubberProps = {
  /** Seconds, from the feed's onProgress. It only has to arrive a few times a second. */
  position: number;
  duration: number;
  /** Seconds buffered ahead, also from onProgress. */
  buffered?: number;
  /** Lets the playhead keep moving between progress events. */
  playing?: boolean;
  /** `precise` is false for the seeks sent while dragging, true for the one on release. */
  onSeek: (seconds: number, precise: boolean) => void;
  onScrubStart?: () => void;
  onScrubEnd?: (seconds: number) => void;
  /** Seek while dragging, not only on release. Default true. */
  liveSeek?: boolean;
  /** Live seek every Nth drag update, about 60 a second. Default 4. */
  liveSeekEvery?: number;
  /** Hold before the bar takes over the touch, in ms. Default 140. */
  holdDelay?: number;
  /** Track height at rest and while held. Defaults 3 and 8. */
  height?: number;
  expandedHeight?: number;
  /** Thumb diameter when held. Default 14, use 0 to hide it. */
  thumbSize?: number;
  /** Time bubble above the thumb while scrubbing. Default true. */
  showTime?: boolean;
  /** Fades the bar out and ignores touches, used while the feed changes page. */
  hidden?: boolean;
  colors?: MediaScrubberColors;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_COLORS: Required<MediaScrubberColors> = {
  track: 'rgba(255,255,255,0.22)',
  buffered: 'rgba(255,255,255,0.38)',
  fill: '#FFFFFF',
  thumb: '#FFFFFF',
  time: '#FFFFFF',
};

const SPRING = { damping: 18, stiffness: 240, mass: 0.6 };

function clock(seconds: number) {
  'worklet';
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

type MotionArgs = Pick<
  MediaScrubberProps,
  | 'position'
  | 'duration'
  | 'buffered'
  | 'playing'
  | 'onSeek'
  | 'onScrubStart'
  | 'onScrubEnd'
  | 'liveSeek'
  | 'liveSeekEvery'
  | 'holdDelay'
  | 'height'
  | 'expandedHeight'
  | 'disabled'
  | 'hidden'
>;

/** Everything that runs on the UI thread. Nothing here re-renders React. */
function useScrubberMotion({
  position,
  duration,
  buffered = 0,
  playing = false,
  onSeek,
  onScrubStart,
  onScrubEnd,
  liveSeek = true,
  liveSeekEvery = 4,
  holdDelay = 140,
  height = 3,
  expandedHeight = 8,
  disabled = false,
  hidden = false,
}: MotionArgs) {
  const width = useSharedValue(0);
  /** Where the playhead is, in seconds. The only value the gesture writes. */
  const head = useSharedValue(0);
  const scrubbing = useSharedValue(false);
  const expand = useSharedValue(0);
  const ticks = useSharedValue(0);
  const lastIncoming = useSharedValue(-1);
  const lastSecond = useSharedValue(-1);
  const label = useSharedValue('0:00 / 0:00');
  /** 0 to 1. Starts at 0, so the bar fades in the first time it appears too. */
  const visible = useSharedValue(0);
  const visibleTarget = useSharedValue(-1);

  // Props mirrored onto the UI thread without an effect.
  const total = useDerivedValue(() => duration);
  const ahead = useDerivedValue(() => buffered);
  const isPlaying = useDerivedValue(() => playing);
  const incoming = useDerivedValue(() => position);
  const isHidden = useDerivedValue(() => hidden);

  // One place owns the playhead: a new progress event re-syncs it, and between events real
  // time carries it forward. The finger wins over both.
  useFrameCallback(({ timeSincePreviousFrame }) => {
    'worklet';
    const fresh = incoming.value !== lastIncoming.value;
    if (fresh) lastIncoming.value = incoming.value;
    if (!scrubbing.value) {
      if (fresh) {
        head.value = incoming.value;
      } else if (isPlaying.value && total.value > 0) {
        head.value = Math.min(total.value, head.value + (timeSincePreviousFrame ?? 0) / 1000);
      }
    }
    // Fading runs from here, so it costs nothing extra and never waits on JS.
    const target = isHidden.value ? 0 : 1;
    if (visibleTarget.value !== target) {
      visibleTarget.value = target;
      visible.value = withTiming(target, { duration: target === 1 ? 220 : 140 });
    }

    // The bubble shows whole seconds, so the text prop changes once a second instead of
    // writing to the native TextInput on every frame.
    const second = Math.floor(head.value);
    if (second !== lastSecond.value) {
      lastSecond.value = second;
      label.value = `${clock(head.value)} / ${clock(total.value)}`;
    }
  });

  const seekTo = (seconds: number, precise: boolean) => onSeek(seconds, precise);

  const pan = Gesture.Pan()
    .enabled(!disabled && !hidden)
    .minDistance(0)
    .activateAfterLongPress(holdDelay)
    .shouldCancelWhenOutside(false)
    .onStart((e) => {
      'worklet';
      scrubbing.value = true;
      ticks.value = 0;
      expand.value = withSpring(1, SPRING);
      if (width.value > 0 && total.value > 0) {
        head.value = (clamp(e.x, 0, width.value) / width.value) * total.value;
      }
      if (onScrubStart) runOnJS(onScrubStart)();
    })
    .onUpdate((e) => {
      'worklet';
      if (width.value <= 0 || total.value <= 0) return;
      head.value = (clamp(e.x, 0, width.value) / width.value) * total.value;
      if (!liveSeek) return;
      // Counting updates keeps this pure, a clock read in a worklet is not.
      ticks.value += 1;
      if (ticks.value % liveSeekEvery === 0) runOnJS(seekTo)(head.value, false);
    })
    .onFinalize(() => {
      'worklet';
      if (!scrubbing.value) return;
      scrubbing.value = false;
      expand.value = withSpring(0, SPRING);
      runOnJS(seekTo)(head.value, true);
      if (onScrubEnd) runOnJS(onScrubEnd)(head.value);
    });

  const progress = () => {
    'worklet';
    return total.value > 0 ? clamp(head.value / total.value, 0, 1) : 0;
  };

  const rootStyle = useAnimatedStyle(() => {
    'worklet';
    return { opacity: visible.value };
  });

  const trackStyle = useAnimatedStyle(() => {
    'worklet';
    const h = height + (expandedHeight - height) * expand.value;
    return { height: h, borderRadius: h / 2 };
  });

  const fillStyle = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ scaleX: progress() }] };
  });

  const bufferedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ scaleX: total.value > 0 ? clamp(ahead.value / total.value, 0, 1) : 0 }],
    };
  });

  const thumbStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateX: progress() * width.value }, { scale: expand.value }],
      opacity: expand.value,
    };
  });

  const bubbleStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: withTiming(scrubbing.value ? 1 : 0, { duration: 120 }),
      transform: [
        { translateX: clamp(progress() * width.value - 34, 0, Math.max(0, width.value - 68)) },
        { translateY: withSpring(scrubbing.value ? 0 : 6, SPRING) },
        { scale: withSpring(scrubbing.value ? 1 : 0.9, SPRING) },
      ],
    };
  });

  const timeProps = useAnimatedProps(() => {
    'worklet';
    return { text: label.value } as any;
  });

  return {
    width,
    pan,
    rootStyle,
    trackStyle,
    fillStyle,
    bufferedStyle,
    thumbStyle,
    bubbleStyle,
    timeProps,
  };
}

/**
 * Seek bar for the current video. Hold to expand it, drag to scrub.
 *
 * The playhead runs on the UI thread: progress props only re-sync it, and a frame callback
 * carries it forward in between, so a busy JS thread doesn't make it stutter.
 */
export function MediaScrubber({
  position,
  duration,
  buffered = 0,
  playing = false,
  onSeek,
  onScrubStart,
  onScrubEnd,
  liveSeek = true,
  liveSeekEvery = 4,
  holdDelay = 140,
  height = 3,
  expandedHeight = 8,
  thumbSize = 14,
  showTime = true,
  hidden = false,
  colors,
  disabled = false,
  style,
}: MediaScrubberProps) {
  const c = { ...DEFAULT_COLORS, ...colors };
  const motion = useScrubberMotion({
    position,
    duration,
    buffered,
    playing,
    onSeek,
    onScrubStart,
    onScrubEnd,
    liveSeek,
    liveSeekEvery,
    holdDelay,
    height,
    expandedHeight,
    disabled,
    hidden,
  });
  const { width, pan, rootStyle, trackStyle, fillStyle, bufferedStyle, thumbStyle, bubbleStyle } =
    motion;
  const { timeProps } = motion;

  const onLayout = (e: LayoutChangeEvent) => {
    width.value = e.nativeEvent.layout.width;
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.root, rootStyle, style]}
        onLayout={onLayout}
        collapsable={false}>
        {showTime ? (
          <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
            <AnimatedTextInput
              editable={false}
              defaultValue=""
              animatedProps={timeProps}
              style={[styles.time, { color: c.time }]}
            />
          </Animated.View>
        ) : null}

        <Animated.View style={[styles.track, { backgroundColor: c.track }, trackStyle]}>
          <Animated.View style={[styles.layer, { backgroundColor: c.buffered }, bufferedStyle]} />
          <Animated.View style={[styles.layer, { backgroundColor: c.fill }, fillStyle]} />
        </Animated.View>

        {thumbSize > 0 ? (
          <Animated.View style={styles.thumbTrack} pointerEvents="none">
            <Animated.View
              style={[
                styles.thumb,
                {
                  width: thumbSize,
                  height: thumbSize,
                  borderRadius: thumbSize / 2,
                  marginLeft: -thumbSize / 2,
                  backgroundColor: c.thumb,
                },
                thumbStyle,
              ]}
            />
          </Animated.View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Padding is the hit area, the visible track stays thin.
  root: { justifyContent: 'center', paddingVertical: 14 },
  track: { overflow: 'hidden', justifyContent: 'center' },
  layer: { ...StyleSheet.absoluteFillObject, transformOrigin: 'left' },
  thumbTrack: { ...StyleSheet.absoluteFillObject, justifyContent: 'center' },
  thumb: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  bubble: { position: 'absolute', top: -18, alignSelf: 'flex-start' },
  time: {
    width: 68,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    padding: 0,
    fontVariant: ['tabular-nums'],
  },
});
