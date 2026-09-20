import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { color } from '../theme';
import type { IconName } from './icons';

type Props = { icon: IconName; onPress: () => void; active?: boolean; accessibilityLabel: string };

/** Round translucent button that floats over media. */
export function GlassButton({ icon, onPress, active, accessibilityLabel }: Props) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.root, active && styles.active, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={active ? color.onLime : color.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.glass,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  active: { backgroundColor: color.lime },
  pressed: { opacity: 0.6, transform: [{ scale: 0.94 }] },
});
