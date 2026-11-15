import { cellLabel, type CellState } from '@logm8/diary-reader';
import { Redirect, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, common } from '../components/theme';
import { Button, Disclaimer, ScreenScroll } from '../components/ui';
import { useController, useSnapshot } from '../state/AppProvider';

const CELL_COLOR: Record<CellState, string> = { work: colors.work, rest: colors.rest, none: colors.none };

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function GridRow({ label, cells, diff, testID }: { label: string; cells: CellState[]; diff: Set<number>; testID: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={common.muted}>{label}</Text>
      <View style={styles.grid} testID={testID}>
        {cells.map((c, i) => (
          <View key={i} accessibilityLabel={`${label} ${cellLabel(i)} ${c}`} style={[styles.cell, { backgroundColor: CELL_COLOR[c] }, diff.has(i) && styles.diff]} />
        ))}
      </View>
    </View>
  );
}

const WORD: Record<CellState, string> = { work: 'work', rest: 'rest', none: 'nothing' };

/** Results of a daily-sheet photo check. */
export function SheetResultScreen() {
  const snap = useSnapshot();
  const controller = useController();
  const router = useRouter();
  const c = snap.sheetCheck;
  if (!c || c.status !== 'done') return <Redirect href="/capture" />;
  const r = c.result;
  const diff = new Set(r.cellDiffs.map((d) => d.cell));
  const missing = r.missing.filter((m) => m.severity === 'missing');
  const checks = r.missing.filter((m) => m.severity === 'check');

  return (
    <ScreenScroll testID="sheet-result">
      <Text style={common.h1}>Diary page check</Text>
      <View style={common.card}>
        <Text style={common.text} testID="sheet-date">
          Sheet for {r.sheetDate} {c.dateSource === 'sheet' ? '(read from the sheet)' : c.dateSource === 'today' ? '(assumed today: change it if needed)' : ''}
        </Text>
        <View style={common.row}>
          <Button title="‹ Day before" tone="ghost" onPress={() => controller.setSheetDate(addDays(r.sheetDate, -1))} testID="date-prev" />
          <Button title="Day after ›" tone="ghost" onPress={() => controller.setSheetDate(addDays(r.sheetDate, 1))} testID="date-next" />
        </View>
        <Text style={common.muted}>
          Sheet version: {c.reading.version === 'v1.4' ? 'v1.4 (from 1 Aug 2026)' : 'before 1 Aug 2026'}. Rules applied: {r.rulesFromReform ? 'from 1 Aug 2026' : 'before 1 Aug 2026'}.
        </Text>
        {!c.handwritingRead ? <Text style={common.muted}>Handwriting (names, places) was not read; only whether each box is filled in.</Text> : null}
      </View>

      <View style={common.card}>
        <Text style={common.h2} testID="grid-summary">
          {r.cellDiffs.length === 0 ? 'Sheet matches your log' : `${r.cellDiffs.length} of 96 blocks differ from your log`}
        </Text>
        <GridRow label="Sheet" cells={r.sheetCells} diff={diff} testID="sheet-row" />
        <GridRow label="App log" cells={r.appCells} diff={diff} testID="app-row" />
        {r.diffRanges.map((d, i) => (
          <Text key={i} style={common.text} testID="diff-range">
            {d.from}–{d.to}: sheet shows {WORD[d.sheet]}, app shows {WORD[d.app]}
          </Text>
        ))}
      </View>

      <View style={[common.card, missing.length > 0 && { borderColor: colors.critical }]} testID="missing">
        <Text style={common.h2}>{missing.length === 0 ? 'Required details filled in' : `${missing.length} required item(s) missing`}</Text>
        {missing.map((m) => (
          <Text key={m.id} style={common.text}>
            • {m.label} <Text style={common.muted}>({m.source})</Text>
          </Text>
        ))}
        {checks.map((m) => (
          <Text key={m.id} style={common.muted}>
            • Check: {m.label}. {m.note}
          </Text>
        ))}
        {r.notRequired.length > 0 ? <Text style={common.muted} testID="not-required">Day of the week, the Standard hours tick and daily totals are optional since 1 August 2026 and are not checked.</Text> : null}
      </View>

      <View style={[common.card, r.breaches.length > 0 && { borderColor: colors.critical }]} testID="sheet-breaches">
        <Text style={common.h2}>{r.breaches.length === 0 ? 'No breaches visible on this sheet' : 'Possible breaches on this sheet'}</Text>
        {r.breaches.slice(0, 6).map((b, i) => (
          <Text key={i} style={common.text}>
            {b.severity ? `[${b.severity}] ` : ''}
            {b.message}
          </Text>
        ))}
        <Text style={common.muted}>Only this one day is checked; limits over 7 and 14 days need your full log.</Text>
      </View>

      <View style={common.row}>
        <Button title="Check another page" onPress={() => router.replace('/capture')} testID="check-another" />
        <Button title="Done" tone="ghost" onPress={() => {
          controller.clearSheetCheck();
          router.replace('/');
        }} testID="result-done" />
      </View>
      <Disclaimer detailed={false} />
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', height: 26, gap: 1 },
  cell: { flex: 1, borderRadius: 1 },
  diff: { borderWidth: 2, borderColor: '#FCA5A5' },
});
