import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { colors, common } from '../components/theme';
import { Button, Disclaimer, ScreenScroll } from '../components/ui';
import { getSheetPhoto } from '../platform/photo';
import { useController, useSnapshot } from '../state/AppProvider';

/** Photograph a Written Work Diary daily sheet so the app can check it. */
export function CaptureScreen() {
  const controller = useController();
  const snap = useSnapshot();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const busy = snap.sheetCheck?.status === 'reading';

  async function run(source: 'camera' | 'library') {
    setMessage(null);
    const photo = await getSheetPhoto(source);
    if (!photo.ok) {
      if (photo.reason !== 'cancelled') setMessage(photo.message);
      return;
    }
    const r = await controller.checkSheet(photo.jpeg);
    if (r.ok) router.push('/sheet-result');
    else setMessage(r.message);
  }

  return (
    <ScreenScroll testID="capture">
      <Text style={common.h1}>Check a diary page</Text>
      <Text style={common.text}>Take a photo of one daily sheet. LogM8 compares the 15-minute grid with what you logged, checks the required boxes are filled in, and looks for breaches on the sheet itself.</Text>
      <View style={common.card}>
        <Text style={common.h2}>For a good photo</Text>
        <Text style={common.muted}>• Lay the sheet flat on a darker surface (seat, dash, clipboard).</Text>
        <Text style={common.muted}>• Get the whole sheet in the photo, straight on, in even light.</Text>
        <Text style={common.muted}>• Avoid shadows and glare across the grid.</Text>
      </View>
      {busy ? (
        <View style={[common.card, { alignItems: 'center' }]} testID="reading">
          <ActivityIndicator color={colors.text} />
          <Text style={common.text}>Reading the sheet…</Text>
        </View>
      ) : (
        <View style={common.row}>
          <Button title="Take photo" onPress={() => void run('camera')} testID="take-photo" />
          <Button title="Choose photo" tone="ghost" onPress={() => void run('library')} testID="choose-photo" />
        </View>
      )}
      {message ? (
        <Text style={common.error} testID="capture-error">
          {message}
        </Text>
      ) : null}
      <Disclaimer detailed={false} />
    </ScreenScroll>
  );
}
