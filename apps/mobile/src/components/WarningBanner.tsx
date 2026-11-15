import { StyleSheet, Text, View } from 'react-native';
import type { Banner } from '../state/controller';
import { colors } from './theme';

/** Large, glanceable banner. It is read-only: safe to show while the vehicle is moving. */
export function WarningBanner({ banner }: { banner: Banner | null }) {
  if (!banner) return null;
  const bg = banner.level === 'critical' ? colors.critical : banner.level === 'warning' ? colors.warning : colors.info;
  return (
    <View style={[styles.wrap, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="warning-banner">
      <Text style={styles.text}>{banner.text}</Text>
      {banner.detail ? <Text style={styles.detail}>{banner.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, padding: 18, gap: 4 },
  text: { color: '#fff', fontSize: 32, fontWeight: '800' },
  detail: { color: '#fff', fontSize: 16, opacity: 0.9 },
});
