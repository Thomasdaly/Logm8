import { StyleSheet, Text, View } from 'react-native';
import type { Slot } from '../lib/timeline';
import { formatLocalTime } from '../lib/tz';
import { colors } from './theme';
import { useLayout } from './useLayout';

const COLOR: Record<Slot['state'], string> = { work: colors.work, rest: colors.rest, none: colors.none, future: colors.future };
const LABEL: Record<Slot['state'], string> = { work: 'work', rest: 'rest', none: 'not recorded', future: 'later' };

/** Today's timeline in 15-minute blocks (base time zone): 4 blocks per hour; 12 hours per row (24 on tablets). */
export function Timeline({ slots, timeZone }: { slots: Slot[]; timeZone: string }) {
  const { hoursPerRow } = useLayout();
  const hours: Slot[][] = [];
  for (let i = 0; i < slots.length; i += 4) hours.push(slots.slice(i, i + 4));
  const rows: Slot[][][] = [];
  for (let i = 0; i < hours.length; i += hoursPerRow) rows.push(hours.slice(i, i + hoursPerRow));
  return (
    <View style={styles.wrap} testID="timeline" accessibilityLabel="Today's timeline in 15 minute blocks">
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((hour, h) => (
            <View key={h} style={styles.hour}>
              <View style={styles.blocks}>
                {hour.map((s) => (
                  <View key={s.start} testID={`slot-${formatLocalTime(timeZone, s.start)}`} accessibilityLabel={`${formatLocalTime(timeZone, s.start)} ${LABEL[s.state]}`} style={[styles.block, { backgroundColor: COLOR[s.state] }]} />
                ))}
              </View>
              <Text style={styles.hourLabel}>{formatLocalTime(timeZone, hour[0]?.start ?? 0).slice(0, 2)}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.legend}>
        {(['work', 'rest', 'none'] as const).map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: COLOR[k] }]} />
            <Text style={styles.legendText}>{LABEL[k]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: { flexDirection: 'row', gap: 2 },
  hour: { flex: 1, gap: 2 },
  blocks: { flexDirection: 'row', gap: 1, height: 34 },
  block: { flex: 1, borderRadius: 2 },
  hourLabel: { color: colors.muted, fontSize: 10, textAlign: 'center' },
  legend: { flexDirection: 'row', gap: 14 },
  legendItem: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  swatch: { width: 12, height: 12, borderRadius: 2 },
  legendText: { color: colors.muted, fontSize: 12 },
});
