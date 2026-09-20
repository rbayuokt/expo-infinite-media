import { Pressable, StyleSheet, Text } from 'react-native';

import { color, radius } from '../theme';

type Props = { label: string; onPress: () => void; variant?: 'solid' | 'ghost'; disabled?: boolean };

/** Lime pill for the main action, outlined pill for the rest. */
export function Button({ label, onPress, variant = 'solid', disabled }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.base, styles[variant], (pressed || disabled) && styles.dim]}>
      <Text style={[styles.label, variant === 'solid' ? styles.solidLabel : styles.ghostLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { height: 46, paddingHorizontal: 22, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  solid: { backgroundColor: color.lime },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  dim: { opacity: 0.45 },
  label: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  solidLabel: { color: color.onLime },
  ghostLabel: { color: color.text },
});
