import { StyleSheet, Text, View } from 'react-native';

import { color, font, radius } from '../theme';

export type Stat = { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' };

const TONE = { ok: color.lime, warn: color.amber, bad: color.coral };

/** Two-column readout for diagnostics, numbers in mono. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.grid}>
      {stats.map((s) => (
        <View key={s.label} style={styles.cell}>
          <View style={[styles.mark, { backgroundColor: s.tone ? TONE[s.tone] : color.faint }]} />
          <View style={styles.text}>
            <Text style={styles.value} numberOfLines={1}>
              {s.value}
            </Text>
            <Text style={styles.label} numberOfLines={1}>
              {s.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: {
    width: '48.8%',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(18,18,25,0.88)',
    borderRadius: radius.sm,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  mark: { width: 3, borderRadius: 2 },
  text: { flex: 1 },
  value: { color: color.text, fontFamily: font.mono, fontSize: 13, fontWeight: '600' },
  label: { color: color.muted, fontSize: 10.5, marginTop: 1 },
});
