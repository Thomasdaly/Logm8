import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { type LocationSample, speedToKmh } from '../lib/motion';
import type { LocationPermissions, LocationPort } from '../state/controller';

const TASK = 'logmate-background-location';

type Listener = (s: LocationSample) => void;
let listener: Listener | null = null;

export function toSample(loc: Location.LocationObject): LocationSample {
  const c = loc.coords;
  return {
    t: loc.timestamp,
    speedKmh: speedToKmh(c.speed),
    fix: { lat: c.latitude, lon: c.longitude, accuracyM: c.accuracy ?? null, fixTime: new Date(loc.timestamp).toISOString() },
  };
}

// Must be defined at module load so the OS can start it in the background (Android foreground service / iOS background mode).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !data) return;
  for (const loc of data.locations) listener?.(toSample(loc));
});

let watch: Location.LocationSubscription | null = null;

export const expoLocation: LocationPort = {
  async getPermissions(): Promise<LocationPermissions> {
    const fg = await Location.getForegroundPermissionsAsync();
    const bg = fg.granted ? await Location.getBackgroundPermissionsAsync() : { granted: false };
    return { foreground: fg.granted, background: bg.granted };
  },

  async requestPermissions(): Promise<LocationPermissions> {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return { foreground: false, background: false };
    // Background ("always") permission is asked for separately, after the rationale was shown. Declining is fine.
    const bg = await Location.requestBackgroundPermissionsAsync();
    return { foreground: true, background: bg.granted };
  },

  async start(onSample: Listener): Promise<void> {
    listener = onSample;
    const perms = await this.getPermissions();
    if (perms.background) {
      if (await Location.hasStartedLocationUpdatesAsync(TASK)) return;
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 10,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        // Android: a foreground service keeps tracking (and spoken warnings) alive when the screen is off.
        foregroundService: {
          notificationTitle: 'LogMate is watching your work and rest limits',
          notificationBody: 'Location is used only to measure speed. Tap to open.',
        },
      });
    } else if (perms.foreground) {
      // Degrade gracefully: foreground-only tracking while the app is open.
      watch?.remove();
      watch = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 }, (loc) => listener?.(toSample(loc)));
    }
  },

  async stop(): Promise<void> {
    listener = null;
    watch?.remove();
    watch = null;
    if (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false)) await Location.stopLocationUpdatesAsync(TASK);
  },
};
