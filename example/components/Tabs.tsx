import { Pressable, StyleSheet, Text, View } from 'react-native';

import { color, radius } from '../theme';

type Props<T> = { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void };

/** Pill tabs, the selected one filled lime. */
export function Tabs<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.tab, selected && styles.selected, pressed && !selected && styles.pressed]}>
            <Text style={[styles.label, selected && styles.selectedLabel]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  selected: { backgroundColor: color.lime, borderColor: color.lime },
  pressed: { backgroundColor: color.raised },
  label: { color: color.muted, fontSize: 13, fontWeight: '700' },
  selectedLabel: { color: color.onLime },
});
