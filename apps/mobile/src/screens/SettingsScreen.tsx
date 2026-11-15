import { useState } from 'react';
import { Share, Switch, Text, View } from 'react-native';
import { runEvaluate } from '../lib/engine';
import { buildContext } from '../lib/engine';
import { common } from '../components/theme';
import { Button, Chip, Disclaimer, ScreenScroll } from '../components/ui';
import { BFM_NOTE } from '../lib/copy';
import type { SchemeFamilyChoice, VerifyResult } from '../lib/types';
import { useController, useSnapshot } from '../state/AppProvider';

export function SettingsScreen() {
  const controller = useController();
  const snap = useSnapshot();
  const p = snap.profile;
  const [family, setFamily] = useState<SchemeFamilyChoice>(p?.schemeFamily ?? 'standard');
  const [twoUp, setTwoUp] = useState(p?.twoUp ?? false);
  const [status, setStatus] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<VerifyResult | null>(null);

  if (!p) return null;
  const changed = family !== p.schemeFamily || twoUp !== p.twoUp;

  async function saveScheme() {
    if (!p) return;
    const r = await controller.saveProfile({ ...p, schemeFamily: family, twoUp });
    setStatus(r.ok ? 'Hours option changed. Check the 48 hour rule below.' : r.message);
  }

  async function exportLog() {
    const all = snap.events;
    const ctx = buildContext(snap.profiles);
    const nowIso = new Date(snap.nowMs).toISOString();
    const evaluation = ctx ? runEvaluate(snap.entries, ctx, nowIso) : null;
    const verify = await controller.verifyIntegrity();
    const json = JSON.stringify({ exportedAt: nowIso, integrity: verify, rulesetVersion: evaluation?.status.rulesetVersion ?? null, evaluation, events: all }, null, 2);
    await Share.share({ message: json, title: 'LogMate export' });
  }

  return (
    <ScreenScroll testID="settings">
      <Text style={common.h1}>Settings</Text>
      <Disclaimer />

      <View style={common.card}>
        <Text style={common.h2}>Your details</Text>
        <Text style={common.text}>Base: {p.baseName}, {p.baseState} ({p.baseTimeZone})</Text>
        <Text style={common.text}>Registration: {p.rego}</Text>
        <Text style={common.text}>Written Work Diary: {p.wwdNumber}</Text>
        <Text style={common.muted}>Recording mode: Written Work Diary</Text>
      </View>

      <View style={common.card}>
        <Text style={common.h2}>Hours option</Text>
        <View style={common.row}>
          <Chip label="Standard Hours" selected={family === 'standard'} onPress={() => setFamily('standard')} />
          <Chip label="BFM (transitional)" selected={family === 'bfm'} onPress={() => setFamily('bfm')} />
        </View>
        {family === 'bfm' ? <Text style={common.muted}>{BFM_NOTE}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={common.text}>Two-up driving</Text>
          <Switch accessibilityLabel="Two-up driving" value={twoUp} onValueChange={setTwoUp} />
        </View>
        <Text style={common.muted}>You can only drive under one hours option at a time. To switch, you must either already comply with the new option's limits or take a rest of at least 48 continuous hours. The app checks this and flags it.</Text>
        <Button title="Change hours option" onPress={() => void saveScheme()} disabled={!changed} testID="save-scheme" />
        {status ? <Text style={common.muted}>{status}</Text> : null}
      </View>

      <View style={common.card}>
        <Text style={common.h2}>Location</Text>
        <Text style={common.text} testID="location-status">
          {snap.locationStatus === 'granted' ? 'Allowed, including in the background' : snap.locationStatus === 'foreground_only' ? 'Allowed while the app is open only. Warnings by voice need background access to work with the screen off.' : snap.locationStatus === 'denied' ? 'Off. You can still log work and rest by hand.' : 'Not asked yet'}
        </Text>
        <Button title="Allow location" tone="ghost" onPress={() => void controller.enableLocation()} testID="settings-enable-location" />
      </View>

      <View style={common.card}>
        <Text style={common.h2}>Records</Text>
        <Text style={common.muted}>Every entry is kept in a tamper-evident log on this phone. Entries are never edited or deleted; a correction is added as a new entry with a reason.</Text>
        <Button title="Check log integrity" tone="ghost" onPress={() => void controller.verifyIntegrity().then(setIntegrity)} testID="verify-integrity" />
        {integrity ? (
          <Text style={integrity.ok ? common.text : common.error} testID="integrity-result">
            {integrity.ok ? `Log intact (${integrity.count} entries).` : `Log problem at entry #${integrity.brokenAtSeq}: ${integrity.reason}`}
          </Text>
        ) : null}
        <Button title="Export log (JSON)" tone="ghost" onPress={() => void exportLog()} testID="export-log" />
      </View>
    </ScreenScroll>
  );
}
