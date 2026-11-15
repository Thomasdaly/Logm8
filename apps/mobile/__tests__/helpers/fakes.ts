import { DriverController, type LocationPermissions, type LocationPort, type SpeechPort } from '../../src/state/controller';
import type { LocationSample } from '../../src/lib/motion';
import type { Profile } from '../../src/lib/types';
import { PROFILE, memoryStore } from './testDb';

/** 2026-11-16 06:00 in Brisbane (UTC+10, no DST). */
export const T0 = Date.UTC(2026, 10, 15, 20, 0);
export const MIN = 60_000;

export class FakeClock {
  constructor(public ms: number = T0) {}
  now = (): number => this.ms;
  advance(minutes: number): void {
    this.ms += minutes * MIN;
  }
}

export class FakeSpeech implements SpeechPort {
  spoken: string[] = [];
  speak(text: string): void {
    this.spoken.push(text);
  }
  stop(): void {}
}

export class FakeLocation implements LocationPort {
  onSample: ((s: LocationSample) => void) | null = null;
  perms: LocationPermissions = { foreground: false, background: false };
  grant: LocationPermissions = { foreground: true, background: true };
  startCalls = 0;
  requestCalls = 0;
  async getPermissions(): Promise<LocationPermissions> {
    return this.perms;
  }
  async requestPermissions(): Promise<LocationPermissions> {
    this.requestCalls++;
    this.perms = this.grant;
    return this.perms;
  }
  async start(onSample: (s: LocationSample) => void): Promise<void> {
    this.startCalls++;
    this.onSample = onSample;
  }
  async stop(): Promise<void> {
    this.onSample = null;
  }
  /** Mocked location: emit a GPS sample at the clock's current time. */
  emit(clock: FakeClock, speedKmh: number | null): void {
    this.onSample?.({ t: clock.ms, speedKmh, fix: { lat: -27.47, lon: 153.02, accuracyM: 6, fixTime: new Date(clock.ms).toISOString() } });
  }
}

export interface Harness {
  controller: DriverController;
  clock: FakeClock;
  speech: FakeSpeech;
  location: FakeLocation;
  store: Awaited<ReturnType<typeof memoryStore>>['store'];
}

export async function makeHarness(opts: { profile?: Profile | null; perms?: LocationPermissions } = {}): Promise<Harness> {
  const { store } = await memoryStore();
  const clock = new FakeClock();
  const speech = new FakeSpeech();
  const location = new FakeLocation();
  if (opts.perms) location.perms = opts.perms;
  const controller = new DriverController({ store, clock: clock.now, speech, location, appVersion: 'test', yieldToUi: () => Promise.resolve() });
  await controller.load();
  const profile = opts.profile === undefined ? PROFILE : opts.profile;
  if (profile) {
    const r = await controller.saveProfile(profile);
    if (!r.ok) throw new Error(r.message);
  }
  return { controller, clock, speech, location, store };
}
