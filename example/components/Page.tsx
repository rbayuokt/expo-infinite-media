import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, eyebrow } from '../theme';

type Props = { kicker: string; title: string; onBack: () => void; children: ReactNode };

/** Round back button, then a big left-aligned title. */
export function Page({ kicker, title, onBack, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      <View style={styles.head}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityLabel="Back"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={20} color={color.text} />
        </Pressable>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.flex}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  head: { paddingHorizontal: 20, paddingBottom: 8, gap: 4 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  pressed: { opacity: 0.6 },
  kicker: eyebrow,
  title: { color: color.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
});
