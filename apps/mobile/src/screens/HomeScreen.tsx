import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { RestLocation } from '@logm8/rules-engine';
import { Countdown } from '../components/Countdown';
import { DrivingLock } from '../components/DrivingLock';
import { Timeline } from '../components/Timeline';
import { colors, common } from '../components/theme';
import { Button, Chip, ScreenScroll } from '../components/ui';
import { useLayout } from '../components/useLayout';
import { WarningBanner } from '../components/WarningBanner';
import { DISCLAIMER } from '../lib/copy';
import { formatLocalTime } from '../lib/tz';
import { useController, useSnapshot } from '../state/AppProvider';

const REST_PLACES: Array<{ value: RestLocation; label: string; twoUpOnly?: boolean }> = [
  { value: 'stationary_out_of_vehicle', label: 'Out of vehicle' },
  { value: 'sleeper_berth_stationary', label: 'Sleeper berth (parked)' },
  { value: 'sleeper_berth_moving', label: 'Sleeper berth (moving)', twoUpOnly: true },
  { value: 'in_vehicle_other', label: 'In vehicle (not sleeper)' },
];

export function HomeScreen() {
  const snap = useSnapshot();
  const controller = useController();
  const router = useRouter();
  const { isWide } = useLayout();
  const [restPlace, setRestPlace] = useState<RestLocation>('stationary_out_of_vehicle');
  const [message, setMessage] = useState<string | null>(null);

  if (!snap.ready) return null;
  if (!snap.profile) return <Redirect href="/onboarding" />;
  if (!snap.interactionAllowed) return <DrivingLock snap={snap} />;

  const tz = snap.profile.baseTimeZone;
  const working = snap.state === 'work';
  const resting = snap.state === 'rest';

  const report = (r: { ok: boolean; message?: string }) => setMessage(r.ok ? null : (r.message ?? 'That did not work.'));

  const status = (
    <View style={common.card}>
      <Text style={common.muted}>{snap.profile.baseName} time ({tz.split('/')[1]})</Text>
      <Text style={common.h1} testID="current-state">
        {working ? 'Working' : resting ? 'Resting' : 'Not started'}
        {snap.stateSinceMs ? ` since ${formatLocalTime(tz, snap.stateSinceMs)}` : ''}
      </Text>
    </View>
  );

  const countdown = <Countdown seconds={snap.countdownSec} working={working} limitLabel={snap.limitLabel} restToClearMin={snap.restToClearMin} />;

  const suggestion = snap.suggestion ? (
    <View style={[common.card, { borderColor: colors.info }]} testID="suggestion">
      <Text style={common.h2}>{snap.suggestion.message}</Text>
      <Text style={common.muted}>Since {formatLocalTime(tz, snap.suggestion.since)}. Nothing is recorded until you confirm.</Text>
      <View style={common.row}>
        <Button title="Confirm" onPress={() => void controller.confirmSuggestion().then(report)} testID="suggestion-confirm" />
        <Button title="Dismiss" tone="ghost" onPress={() => controller.dismissSuggestion()} testID="suggestion-dismiss" />
      </View>
    </View>
  ) : null;

  const controls = (
    <View style={common.card}>
      <View style={common.row}>
        <Button title="Start Work" tone="work" onPress={() => void controller.startWork().then(report)} disabled={working} testID="start-work" />
        <Button title="Start Rest" tone="rest" onPress={() => void controller.startRest(restPlace).then(report)} disabled={resting && snap.entries[snap.entries.length - 1]?.restLocation === restPlace} testID="start-rest" />
      </View>
      <Text style={common.muted}>Rest taken:</Text>
      <View style={common.row}>
        {REST_PLACES.filter((p) => !p.twoUpOnly || snap.profile?.twoUp).map((p) => (
          <Chip key={p.value} label={p.label} selected={restPlace === p.value} onPress={() => setRestPlace(p.value)} />
        ))}
      </View>
      {message ? (
        <Text style={common.error} testID="action-error">
          {message}
        </Text>
      ) : null}
    </View>
  );

  const today = (
    <View style={common.card}>
      <Text style={common.h2}>Today</Text>
      <Timeline slots={snap.slots} timeZone={tz} />
    </View>
  );

  const breaches =
    snap.evaluationKind === 'breach' || snap.breaches.length > 0 ? (
      <View style={[common.card, { borderColor: colors.critical }]} testID="breaches">
        <Text style={common.h2}>Possible breaches in your recent record</Text>
        {snap.breaches.map((b, i) => (
          <Text key={i} style={common.muted}>
            {b.severity ? `[${b.severity}] ` : ''}
            {b.message}
          </Text>
        ))}
      </View>
    ) : null;

  const links = (
    <View style={common.row}>
      <Button title="Check diary page" tone="ghost" onPress={() => router.push('/capture')} testID="open-capture" />
      <Button title="History" tone="ghost" onPress={() => router.push('/history')} testID="open-history" />
      <Button title="Settings" tone="ghost" onPress={() => router.push('/settings')} testID="open-settings" />
    </View>
  );

  return (
    <ScreenScroll testID="home">
      <WarningBanner banner={snap.banner} />
      {isWide ? (
        // Tablet (iPad) and landscape: glanceable countdown + controls on the left, the day's record on the right.
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start' }} testID="home-wide">
          <View style={{ flex: 1, gap: 14 }} testID="home-left">
            {status}
            {countdown}
            {suggestion}
            {controls}
          </View>
          <View style={{ flex: 1, gap: 14 }} testID="home-right">
            {today}
            {breaches}
            {links}
          </View>
        </View>
      ) : (
        <>
          {status}
          {countdown}
          {suggestion}
          {controls}
          {today}
          {breaches}
          {links}
        </>
      )}
      <Text style={common.muted}>{DISCLAIMER}</Text>
    </ScreenScroll>
  );
}
