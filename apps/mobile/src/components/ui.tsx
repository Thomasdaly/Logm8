import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DISCLAIMER, DISCLAIMER_DETAIL } from '../lib/copy';
import { colors, common } from './theme';
import { useLayout } from './useLayout';

export function Button({ title, onPress, tone = 'primary', disabled = false, testID }: { title: string; onPress: () => void; tone?: 'primary' | 'work' | 'rest' | 'ghost' | 'danger'; disabled?: boolean; testID?: string }) {
  const bg = tone === 'work' ? colors.work : tone === 'rest' ? colors.rest : tone === 'danger' ? colors.danger : tone === 'ghost' ? 'transparent' : colors.button;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, tone === 'ghost' && styles.ghost]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

/** Scrolling screen whose content is centred and capped in width, so it reads well on an iPad. */
export function ScreenScroll({ children, testID, keyboardShouldPersistTaps }: { children: ReactNode; testID?: string; keyboardShouldPersistTaps?: 'always' | 'handled' | 'never' }) {
  const { contentMaxWidth } = useLayout();
  return (
    <ScrollView style={common.screen} contentContainerStyle={[common.content, { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }]} testID={testID} keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? 'never'}>
      {children}
    </ScrollView>
  );
}

export function Chip({ label, selected, onPress, disabled = false }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && { opacity: 0.4 }]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

/** The legal-positioning disclaimer (SPEC §1, §5). Shown in onboarding and in settings. */
export function Disclaimer({ detailed = true }: { detailed?: boolean }) {
  return (
    <View style={[common.card, { borderColor: colors.warning }]} accessibilityRole="summary" testID="disclaimer">
      <Text style={[common.h2]}>{DISCLAIMER}</Text>
      {detailed ? <Text style={common.muted}>{DISCLAIMER_DETAIL}</Text> : null}
    </View>
  );
}

export function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={common.text}>{label}</Text>
      {children}
      {error ? <Text style={common.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, flexGrow: 1 },
  ghost: { borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipSelected: { backgroundColor: colors.button, borderColor: colors.button },
  chipText: { color: colors.text, fontSize: 16 },
});
