import { Ionicons } from '@expo/vector-icons';
import { Children, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { color, eyebrow, radius } from '../theme';
import type { IconName } from './icons';

export function ActionSection({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.card}>
        {rows.map((row, i) => (
          <View key={i} style={i > 0 && styles.divider}>
            {row}
          </View>
        ))}
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

type RowProps = {
  icon: IconName;
  label: string;
  detail?: string;
  accent?: string;
  trailing?: ReactNode;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  danger?: boolean;
  onPress?: () => void;
};

/** Outlined icon, label, and an optional detail line, switch or trailing view. */
export function ActionRow({ icon, label, detail, accent = color.text, trailing, toggle, danger, onPress }: RowProps) {
  const tint = danger ? color.coral : accent;
  const body = (
    <>
      <View style={[styles.icon, { borderColor: tint }]}>
        <Ionicons name={icon} size={17} color={tint} />
      </View>
      <View style={styles.text}>
        <Text style={[styles.label, danger && { color: color.coral }]}>{label}</Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ true: color.lime, false: color.raised }}
          thumbColor={toggle.value ? color.onLime : color.muted}
          ios_backgroundColor={color.raised}
        />
      ) : trailing !== undefined ? (
        trailing
      ) : onPress ? (
        <Ionicons name="arrow-forward" size={16} color={color.faint} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  title: { ...eyebrow, marginLeft: 4 },
  note: { color: color.faint, fontSize: 12, lineHeight: 17, marginHorizontal: 4 },
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
  },
  divider: { borderTopWidth: 1, borderTopColor: color.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 16, minHeight: 56 },
  pressed: { backgroundColor: color.raised },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  label: { color: color.text, fontSize: 16, fontWeight: '600' },
  detail: { color: color.muted, fontSize: 13, lineHeight: 18 },
});
