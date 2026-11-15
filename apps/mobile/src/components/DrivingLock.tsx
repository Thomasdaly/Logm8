import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Snapshot } from '../state/controller';
import { Countdown } from './Countdown';
import { colors } from './theme';
import { useLayout } from './useLayout';
import { WarningBanner } from './WarningBanner';

/**
 * Shown instead of every interactive screen while speed is above 10 km/h (SPEC §5): read-only countdown and
 * banner. Spoken warnings continue.
 */
export function DrivingLock({ snap }: { snap: Snapshot }) {
  const { contentMaxWidth, isWide } = useLayout();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={[styles.content, { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }]} testID="driving-lock">
      <Text style={[styles.title, isWide && { fontSize: 44 }]}>Driving</Text>
      <Text style={styles.sub}>Controls are locked while the vehicle is moving.</Text>
      <WarningBanner banner={snap.banner} />
      <Countdown seconds={snap.countdownSec} working={snap.state === 'work'} limitLabel={snap.limitLabel} restToClearMin={snap.restToClearMin} />
      {snap.suggestion ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>{snap.suggestion.message} Confirm when you have stopped.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16, flexGrow: 1, justifyContent: 'center' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  note: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 },
  noteText: { color: colors.text, fontSize: 18, textAlign: 'center' },
});
