import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '../components/icons';
import { color, eyebrow, radius } from '../theme';

export type Route = 'feed' | 'layouts' | 'stress' | 'cache';

function Tile({ icon, accent, title, body, onPress }: { icon: IconName; accent: string; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={[styles.tileIcon, { borderColor: accent }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileBody} numberOfLines={3}>
          {body}
        </Text>
      </View>
    </Pressable>
  );
}

export function HomeScreen({ onOpen }: { onOpen: (route: Route) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}>
      <Text style={styles.kicker}>@rbayuokt/expo-infinite-media</Text>
      <Text style={styles.wordmark}>
        infinite{'\n'}media<Text style={{ color: color.lime }}>.</Text>
      </Text>
      <Text style={styles.lead}>
        Swipe through videos and photos. Players, preloading and the cache live in native code, so
        JavaScript only draws what's on top.
      </Text>

      <View style={styles.row}>
        <Tile
          icon="play"
          accent={color.lime}
          title="Feed"
          body="Tap to pause, double tap to like, swipe for more"
          onPress={() => onOpen('feed')}
        />
        <Tile
          icon="grid"
          accent={color.violet}
          title="Layouts"
          body="One feed, five different sets of props"
          onPress={() => onOpen('layouts')}
        />
      </View>

      <View style={styles.row}>
        <Tile
          icon="flash"
          accent={color.amber}
          title="Stress"
          body="1,200 posts, auto swipe, rapid jumps, remounts"
          onPress={() => onOpen('stress')}
        />
        <Tile
          icon="layers"
          accent={color.sky}
          title="Cache"
          body="Disk usage, per-post status, preload, clear"
          onPress={() => onOpen('cache')}
        />
      </View>

      <Text style={styles.foot}>Every 37th post is a broken video and every 41st a missing photo, on purpose.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: 20, gap: 18 },
  // The package name reads as itself, so no uppercasing here.
  kicker: { ...eyebrow, textTransform: 'none' as const, letterSpacing: 0.6, fontSize: 12 },
  wordmark: { color: color.text, fontSize: 56, lineHeight: 56, fontWeight: '900', letterSpacing: -2 },
  lead: { color: color.muted, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  hero: {
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    borderLeftWidth: 3,
    borderLeftColor: color.lime,
    padding: 20,
    minHeight: 190,
    justifyContent: 'flex-end',
    gap: 6,
  },
  heroTop: {
    position: 'absolute',
    top: 18,
    left: 20,
    right: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroKicker: eyebrow,
  play: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: color.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  heroBody: { color: color.muted, fontSize: 14 },
  row: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    padding: 16,
    minHeight: 170,
    justifyContent: 'space-between',
  },
  tileText: { gap: 4, minHeight: 78 },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { color: color.text, fontSize: 19, fontWeight: '800' },
  tileBody: { color: color.muted, fontSize: 13, lineHeight: 18 },
  foot: { color: color.faint, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 6 },
});
