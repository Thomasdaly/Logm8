import { StyleSheet } from 'react-native';

/** High-contrast dark palette for use in a cab. */
export const colors = {
  bg: '#0B0F14',
  card: '#151B23',
  border: '#2A3340',
  text: '#F2F5F8',
  muted: '#9AA7B5',
  work: '#2F9E44',
  rest: '#3B82F6',
  none: '#3A4350',
  future: '#1B222C',
  info: '#1D4ED8',
  warning: '#B45309',
  critical: '#B91C1C',
  button: '#2563EB',
  danger: '#B91C1C',
};

export const common = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700' },
  text: { color: colors.text, fontSize: 16 },
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: '#FCA5A5', fontSize: 14 },
  input: { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1, borderRadius: 10, color: colors.text, padding: 12, fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
});
