// Importing the location platform module registers the background task before the app renders.
import '../src/platform/location';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DrivingLock } from '../src/components/DrivingLock';
import { colors } from '../src/components/theme';
import { AppProvider, useSnapshot } from '../src/state/AppProvider';
import { createProductionController } from '../src/state/bootstrap';

function Gate() {
  const snap = useSnapshot();
  // Above 10 km/h no interactive UI is rendered anywhere in the app (SPEC §5).
  if (snap.ready && snap.profile && !snap.interactionAllowed) return <DrivingLock snap={snap} />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: 'LogM8' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Set up', headerBackVisible: false }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="history" options={{ title: 'History' }} />
      <Stack.Screen name="capture" options={{ title: 'Check a diary page' }} />
      <Stack.Screen name="sheet-result" options={{ title: 'Diary page check' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProvider create={createProductionController}>
      <StatusBar style="light" />
      <Gate />
    </AppProvider>
  );
}
