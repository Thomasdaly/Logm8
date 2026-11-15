import { StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';
import { useLayout } from './useLayout';

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface Props {
  seconds: number | null;
  working: boolean;
  limitLabel: string;
  restToClearMin: number | null;
}

/** Big live countdown to the next required rest (while working), or available work time (while resting). */
export function Countdown({ seconds, working, limitLabel, restToClearMin }: Props) {
  const { countdownFontSize } = useLayout();
  const urgent = working && seconds !== null && seconds <= 15 * 60;
  return (
    <View style={styles.wrap} accessibilityRole="timer" testID="countdown">
      <Text style={styles.caption}>{working ? 'Next required rest in' : 'Work time available if you start now'}</Text>
      <Text style={[styles.time, { fontSize: countdownFontSize, lineHeight: countdownFontSize * 1.15 }, urgent && { color: '#FCA5A5' }]} accessibilityLabel={seconds === null ? 'No limit ahead' : `countdown ${formatHMS(seconds)}`} testID="countdown-time">
        {seconds === null ? '--:--:--' : formatHMS(seconds)}
      </Text>
      {limitLabel ? <Text style={styles.limit}>{limitLabel}</Text> : null}
      {restToClearMin !== null && working ? <Text style={styles.limit}>Rest needed then: {restToClearMin >= 60 ? `${Math.floor(restToClearMin / 60)} h ${restToClearMin % 60} min` : `${restToClearMin} min`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  caption: { color: colors.muted, fontSize: 16 },
  time: { color: colors.text, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'] },
  limit: { color: colors.muted, fontSize: 15, textAlign: 'center' },
});
