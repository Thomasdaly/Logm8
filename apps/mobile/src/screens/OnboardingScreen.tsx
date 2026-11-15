import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { colors, common } from '../components/theme';
import { Button, Chip, Disclaimer, Field, ScreenScroll } from '../components/ui';
import { BFM_NOTE, LOCATION_RATIONALE } from '../lib/copy';
import { BASE_OPTIONS, UNSUPPORTED_BASES, validateProfileInput } from '../lib/profile';
import type { BaseState, SchemeFamilyChoice } from '../lib/types';
import { useController, useSnapshot } from '../state/AppProvider';

export function OnboardingScreen() {
  const controller = useController();
  const snap = useSnapshot();
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [family, setFamily] = useState<SchemeFamilyChoice>('standard');
  const [twoUp, setTwoUp] = useState(false);
  const [baseName, setBaseName] = useState('');
  const [baseState, setBaseState] = useState<BaseState | null>(null);
  const [rego, setRego] = useState('');
  const [wwd, setWwd] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit() {
    const v = validateProfileInput({ schemeFamily: family, twoUp, baseName, baseState, rego, wwdNumber: wwd });
    if (!v.ok) {
      setErrors(v.errors as Record<string, string>);
      return;
    }
    setErrors({});
    const r = await controller.saveProfile(v.profile);
    if (!r.ok) setSubmitError(r.message);
    else router.replace('/');
  }

  return (
    <ScreenScroll keyboardShouldPersistTaps="handled" testID="onboarding">
      <Text style={common.h1}>Welcome to LogM8</Text>
      <Disclaimer />
      <View style={common.row}>
        <Chip label={acknowledged ? 'I understand ✓' : 'I understand'} selected={acknowledged} onPress={() => setAcknowledged(true)} />
      </View>

      {acknowledged ? (
        <>
          <Text style={common.h2}>Your hours option</Text>
          <View style={common.row}>
            <Chip label="Standard Hours" selected={family === 'standard'} onPress={() => setFamily('standard')} />
            <Chip label="BFM (transitional)" selected={family === 'bfm'} onPress={() => setFamily('bfm')} />
          </View>
          {family === 'bfm' ? <Text style={common.muted}>{BFM_NOTE}</Text> : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={common.text}>Two-up driving</Text>
            <Switch accessibilityLabel="Two-up driving" value={twoUp} onValueChange={setTwoUp} />
          </View>

          <Text style={common.h2}>Your base</Text>
          <Field label="Base (town or depot)" error={errors.baseName}>
            <TextInput accessibilityLabel="Base" placeholder="e.g. Toowoomba" placeholderTextColor={colors.muted} style={common.input} value={baseName} onChangeText={setBaseName} />
          </Field>
          <Field label="State of your base (sets your time zone)" error={errors.baseState}>
            <View style={common.row}>
              {BASE_OPTIONS.map((o) => (
                <Chip key={o.state} label={o.state} selected={baseState === o.state} onPress={() => setBaseState(o.state)} />
              ))}
            </View>
          </Field>
          <Text style={common.muted}>{UNSUPPORTED_BASES.join(' and ')} are not supported in this version.</Text>
          {baseState ? <Text style={common.muted}>Time zone: {BASE_OPTIONS.find((o) => o.state === baseState)?.timeZone}. All your hours are counted in base time, wherever you drive.</Text> : null}

          <Text style={common.h2}>Vehicle and diary</Text>
          <Field label="Registration" error={errors.rego}>
            <TextInput accessibilityLabel="Registration" autoCapitalize="characters" placeholder="ABC123" placeholderTextColor={colors.muted} style={common.input} value={rego} onChangeText={setRego} />
          </Field>
          <Field label="Written Work Diary number" error={errors.wwdNumber}>
            <TextInput accessibilityLabel="Written Work Diary number" placeholder="Number printed on your diary" placeholderTextColor={colors.muted} style={common.input} value={wwd} onChangeText={setWwd} />
          </Field>
          <Text style={common.muted}>Recording mode: Written Work Diary (time is counted in 15 minute blocks).</Text>

          <View style={common.card}>
            <Text style={common.h2}>Location</Text>
            <Text style={common.muted}>{LOCATION_RATIONALE}</Text>
            <Button title={snap.locationStatus === 'unknown' ? 'Allow location' : `Location: ${snap.locationStatus.replace('_', ' ')}`} tone="ghost" onPress={() => void controller.enableLocation()} testID="enable-location" />
          </View>

          {submitError ? <Text style={common.error}>{submitError}</Text> : null}
          <Button title="Save and start" onPress={() => void submit()} testID="save-profile" />
        </>
      ) : (
        <Text style={common.muted}>Please read the notice above to continue.</Text>
      )}
    </ScreenScroll>
  );
}
