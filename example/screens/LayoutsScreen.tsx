import { ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionRow, ActionSection } from '../components/ActionList';
import { Page } from '../components/Page';
import { color } from '../theme';
import { PRESETS } from '../data/presets';

/** One feed component, five sets of props. */
export function LayoutsScreen({ onOpen, onBack }: { onOpen: (presetId: string) => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Page kicker="Same component" title="Layouts" onBack={onBack}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.lead}>
          Every layout below is the same InfiniteMediaFeed. Only props change: the overlay you
          render, the seek bar options, resize mode and paging direction.
        </Text>
        <ActionSection title="Pick one" note="Open any of them, swipe, then come back and try another.">
          {PRESETS.map((preset) => (
            <ActionRow
              key={preset.id}
              icon={preset.icon}
              accent={preset.accent}
              label={preset.title}
              detail={preset.subtitle}
              onPress={() => onOpen(preset.id)}
            />
          ))}
        </ActionSection>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingTop: 12, gap: 22 },
  lead: { color: color.muted, fontSize: 14, lineHeight: 20 },
});
