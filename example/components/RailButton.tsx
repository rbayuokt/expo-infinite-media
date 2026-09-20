import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';

import { color, textShadow } from '../theme';
import type { IconName } from './icons';

type Props = {
  icon: IconName;
  label?: string;
  tint?: string;
  /** Changing this plays a small pop, e.g. on like. */
  bumpKey?: unknown;
  onPress: () => void;
  accessibilityLabel: string;
};

/** Icon with a count under it, for the feed's right-hand action rail. */
export function RailButton({ icon, label, tint = color.text, bumpKey, onPress, accessibilityLabel }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scale.setValue(0.7);
    Animated.spring(scale, { toValue: 1, friction: 3, tension: 160, useNativeDriver: true }).start();
  }, [bumpKey, scale]);

  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={icon} size={32} color={tint} style={styles.icon} />
      </Animated.View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 2 },
  pressed: { opacity: 0.6 },
  icon: { ...textShadow },
  label: { color: color.text, fontSize: 12, fontWeight: '600', ...textShadow },
});
