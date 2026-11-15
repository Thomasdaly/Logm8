import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { colors, common } from '../components/theme';
import { Button, ScreenScroll } from '../components/ui';
import type { StateEntry } from '../lib/projection';
import { formatLocalDateTime } from '../lib/tz';
import { useController, useSnapshot } from '../state/AppProvider';

/** The log. Entries are never edited: "Correct" adds a correction entry with a reason. */
export function HistoryScreen() {
  const snap = useSnapshot();
  const controller = useController();
  const [target, setTarget] = useState<StateEntry | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!snap.profile) return null;
  const tz = snap.profile.baseTimeZone;
  const rows = [...snap.entries].reverse().slice(0, 40);
  const corrections = snap.events.filter((e) => e.type === 'correction');

  async function apply(change: Parameters<typeof controller.correct>[2]) {
    if (!target) return;
    if (reason.trim().length === 0) {
      setError('Enter a reason for the correction.');
      return;
    }
    const r = await controller.correct(target.seq, reason.trim(), change);
    if (!r.ok) setError(r.message);
    else {
      setError(null);
      setTarget(null);
      setReason('');
    }
  }

  return (
    <ScreenScroll testID="history">
      <Text style={common.h1}>History</Text>
      <Text style={common.muted}>Original entries are never changed or removed. A correction is added as a new entry with your reason ({corrections.length} so far).</Text>
      {rows.length === 0 ? <Text style={common.muted}>Nothing logged yet.</Text> : null}
      {rows.map((e) => (
        <View key={e.seq} style={common.card}>
          <Text style={common.text}>
            {e.state === 'work' ? 'Work' : 'Rest'} from {formatLocalDateTime(tz, Date.parse(e.at))}
            {e.correctedBySeq ? ' (corrected)' : ''}
            {e.source === 'suggestion' ? ' (from a suggestion)' : ''}
          </Text>
          <Button title="Correct" tone="ghost" onPress={() => { setTarget(e); setError(null); }} testID={`correct-${e.seq}`} />
        </View>
      ))}

      {target ? (
        <View style={[common.card, { borderColor: colors.warning }]} testID="correction-form">
          <Text style={common.h2}>Correct entry from {formatLocalDateTime(tz, Date.parse(target.at))}</Text>
          <TextInput accessibilityLabel="Reason for correction" placeholder="Reason (required)" placeholderTextColor={colors.muted} style={common.input} value={reason} onChangeText={setReason} />
          <View style={common.row}>
            <Button title="15 min earlier" tone="ghost" onPress={() => void apply({ state: target.state, at: Date.parse(target.at) - 15 * 60_000, ...(target.restLocation ? { restLocation: target.restLocation } : {}) })} testID="correct-earlier" />
            <Button title="15 min later" tone="ghost" onPress={() => void apply({ state: target.state, at: Date.parse(target.at) + 15 * 60_000, ...(target.restLocation ? { restLocation: target.restLocation } : {}) })} testID="correct-later" />
          </View>
          <View style={common.row}>
            <Button title={target.state === 'work' ? 'Change to rest' : 'Change to work'} tone="ghost" onPress={() => void apply({ state: target.state === 'work' ? 'rest' : 'work', at: Date.parse(target.at) })} testID="correct-swap" />
            <Button title="Withdraw entry" tone="danger" onPress={() => void apply({ void: true })} testID="correct-void" />
          </View>
          <Button title="Cancel" tone="ghost" onPress={() => setTarget(null)} />
          {error ? <Text style={common.error}>{error}</Text> : null}
        </View>
      ) : null}
    </ScreenScroll>
  );
}
