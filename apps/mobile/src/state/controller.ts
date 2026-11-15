import type { Breach, EvaluationContext, Forecast, RestLocation } from '@logmate/rules-engine';
import type { EventStore } from '../lib/eventStore';
import { FAST_HISTORY_DAYS, buildContext, limitLabel, mergeForecasts, runEvaluate, runForecast, tierContexts } from '../lib/engine';
import { MotionSuggester, type LocationSample, type Suggestion } from '../lib/motion';
import { type ProfileVersion, type StateEntry, currentEntry, profileHistory, projectEntries, toWorkRestEvents } from '../lib/projection';
import { isInteractionAllowed } from '../lib/safety';
import { type Slot, buildTodaySlots } from '../lib/timeline';
import type { DriverState, GeoFix, NewEvent, Profile, StoredEvent, VerifyResult } from '../lib/types';
import { WarningTracker } from '../lib/warnings';

export interface SpeechPort {
  speak(text: string): void;
  stop(): void;
}

export interface LocationPermissions {
  foreground: boolean;
  background: boolean;
}

export interface LocationPort {
  /** Current permissions, without prompting. */
  getPermissions(): Promise<LocationPermissions>;
  /** Prompts the driver (foreground first, then background). Only called from an explicit button press. */
  requestPermissions(): Promise<LocationPermissions>;
  start(onSample: (s: LocationSample) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface ControllerDeps {
  store: EventStore;
  /** Current time. Injected so tests can mock the clock; the rules engine itself never reads a clock. */
  clock: () => number;
  speech: SpeechPort;
  location: LocationPort;
  appVersion: string;
  /** Lets the UI paint between button press and the (CPU-heavy) forecast. */
  yieldToUi?: () => Promise<void>;
}

export type BannerLevel = 'info' | 'warning' | 'critical';
export interface Banner {
  level: BannerLevel;
  text: string;
  detail?: string;
  /** Warning threshold in minutes this banner is for (0 = limit reached). */
  threshold?: number;
}

export type LocationStatus = 'unknown' | 'granted' | 'foreground_only' | 'denied';

export interface Snapshot {
  ready: boolean;
  nowMs: number;
  profile: Profile | null;
  profiles: ProfileVersion[];
  events: StoredEvent[];
  entries: StateEntry[];
  state: DriverState | null;
  stateSinceMs: number | null;
  speedKmh: number | null;
  interactionAllowed: boolean;
  forecast: Forecast | null;
  /** Seconds to the earliest limit if the driver is/keeps working. null if nothing binds. */
  countdownSec: number | null;
  limitLabel: string;
  restToClearMin: number | null;
  suggestion: Suggestion | null;
  banner: Banner | null;
  slots: Slot[];
  breaches: Breach[];
  evaluationKind: 'compliant' | 'breach' | 'unsupported_jurisdiction' | 'invalid_input' | null;
  locationStatus: LocationStatus;
}

export type ActionResult = { ok: true } | { ok: false; reason: 'moving' | 'already' | 'no_profile' | 'error'; message: string };

const MOVING_MSG = 'Controls are locked while the vehicle is moving.';
const SPEED_STALE_MS = 2 * 60_000;
const FORECAST_REFRESH_WHEN_RESTING_MS = 5 * 60_000;
const SLOTS_REFRESH_MS = 30_000;

function bannerLevel(threshold: number): BannerLevel {
  return threshold <= 5 ? 'critical' : threshold <= 30 ? 'warning' : 'info';
}

export class DriverController {
  private listeners = new Set<() => void>();
  private snap: Snapshot;
  private ctx: EvaluationContext | null = null;
  private motion = new MotionSuggester();
  private warnings = new WarningTracker();
  private lastFix: GeoFix | null = null;
  private lastSampleMs: number | null = null;
  private rawSpeedKmh: number | null = null;
  private forecastAtMs: number | null = null;
  private generation = 0;
  private slotsAtMs = 0;
  private tracking = false;
  private episode = '';
  private suggestionSpoken: string | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.snap = {
      ready: false,
      nowMs: deps.clock(),
      profile: null,
      profiles: [],
      events: [],
      entries: [],
      state: null,
      stateSinceMs: null,
      speedKmh: null,
      interactionAllowed: true,
      forecast: null,
      countdownSec: null,
      limitLabel: '',
      restToClearMin: null,
      suggestion: null,
      banner: null,
      slots: [],
      breaches: [],
      evaluationKind: null,
      locationStatus: 'unknown',
    };
  }

  // ---- external store plumbing (useSyncExternalStore) ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  // ---- lifecycle ----
  async load(): Promise<void> {
    const events = await this.deps.store.list();
    await this.applyEvents(events);
    const perms = await this.deps.location.getPermissions();
    this.set({ ready: true, locationStatus: this.statusOf(perms) });
    if (perms.foreground && this.snap.profile) await this.startTracking();
  }

  async dispose(): Promise<void> {
    this.tracking = false;
    await this.deps.location.stop();
    this.deps.speech.stop();
  }

  private statusOf(p: LocationPermissions): LocationStatus {
    return p.foreground && p.background ? 'granted' : p.foreground ? 'foreground_only' : 'denied';
  }

  // ---- location / motion ----
  /** Called from an explicit button press: asks for permission with the honest explanation shown first. */
  async enableLocation(): Promise<LocationStatus> {
    const perms = await this.deps.location.requestPermissions();
    this.set({ locationStatus: this.statusOf(perms) });
    if (perms.foreground) await this.startTracking();
    return this.snap.locationStatus;
  }

  private async startTracking(): Promise<void> {
    if (this.tracking) return;
    this.tracking = true;
    try {
      await this.deps.location.start((s) => this.handleSample(s));
    } catch {
      this.tracking = false;
    }
  }

  /** A new GPS sample. This can only create a *suggestion*; nothing is written to the log. */
  handleSample(sample: LocationSample): void {
    this.lastSampleMs = sample.t;
    this.rawSpeedKmh = sample.speedKmh;
    if (sample.fix) this.lastFix = sample.fix;
    const s = this.motion.update(sample, this.snap.state);
    this.refreshDerived(this.deps.clock());
    const key = s ? `${s.kind}:${s.since}` : null;
    if (s && key !== this.suggestionSpoken) {
      this.suggestionSpoken = key;
      this.deps.speech.speak(s.kind === 'start_work' ? 'Movement detected. Confirm work when stopped.' : 'Stopped for fifteen minutes. Confirm rest.');
    }
    if (!s) this.suggestionSpoken = null;
  }

  private currentSpeed(now: number): number | null {
    if (this.lastSampleMs === null || now - this.lastSampleMs > SPEED_STALE_MS) return null;
    return this.rawSpeedKmh;
  }

  // ---- logging ----
  private stamp<T extends NewEvent['type']>(type: T, payload: NewEvent<T>['payload']): NewEvent<T> {
    const now = this.deps.clock();
    return {
      type,
      payload,
      deviceTime: new Date(now).toISOString(),
      // Offline-first: no network time source in stage 2. The GNSS fix time inside `position` is the trusted time.
      networkTime: null,
      position: this.lastFix,
      appVersion: this.deps.appVersion,
    };
  }

  private async append<T extends NewEvent['type']>(type: T, payload: NewEvent<T>['payload']): Promise<void> {
    await this.deps.store.append(this.stamp(type, payload));
    await this.applyEvents(await this.deps.store.list());
  }

  private gate(): ActionResult | null {
    if (!isInteractionAllowed(this.currentSpeed(this.deps.clock()))) return { ok: false, reason: 'moving', message: MOVING_MSG };
    return null;
  }

  async saveProfile(profile: Profile): Promise<ActionResult> {
    const blocked = this.gate();
    if (blocked) return blocked;
    try {
      await this.append('profile', { profile });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message };
    }
  }

  async startWork(opts: { at?: number; source?: 'manual' | 'suggestion' } = {}): Promise<ActionResult> {
    return this.logState('work', undefined, opts);
  }

  async startRest(restLocation: RestLocation = 'stationary_out_of_vehicle', opts: { at?: number; source?: 'manual' | 'suggestion' } = {}): Promise<ActionResult> {
    return this.logState('rest', restLocation, opts);
  }

  private async logState(state: DriverState, restLocation: RestLocation | undefined, opts: { at?: number; source?: 'manual' | 'suggestion' }): Promise<ActionResult> {
    if (!this.snap.profile) return { ok: false, reason: 'no_profile', message: 'Finish setup first.' };
    const blocked = this.gate();
    if (blocked) return blocked;
    if (this.snap.state === state && (state === 'work' || restLocation === this.currentRestLocation())) {
      return { ok: false, reason: 'already', message: state === 'work' ? 'Already working.' : 'Already resting.' };
    }
    const now = this.deps.clock();
    const last = this.snap.entries[this.snap.entries.length - 1];
    let at = opts.at ?? now;
    if (last && Date.parse(last.at) >= at) at = Math.max(now, Date.parse(last.at) + 1000);
    try {
      const payload: NewEvent<'state_change'>['payload'] = { state, at: new Date(at).toISOString(), source: opts.source ?? 'manual' };
      if (state === 'rest') payload.restLocation = restLocation ?? 'stationary_out_of_vehicle';
      await this.append('state_change', payload);
      this.motion.clear();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message };
    }
  }

  private currentRestLocation(): RestLocation | undefined {
    const e = this.snap.entries[this.snap.entries.length - 1];
    return e?.state === 'rest' ? e.restLocation : undefined;
  }

  /** The driver confirmed a motion suggestion. This is the only way a suggestion becomes a record. */
  async confirmSuggestion(): Promise<ActionResult> {
    const s = this.motion.suggestion;
    if (!s) return { ok: false, reason: 'error', message: 'There is nothing to confirm.' };
    const res = s.kind === 'start_work' ? await this.startWork({ at: s.since, source: 'suggestion' }) : await this.startRest('stationary_out_of_vehicle', { at: s.since, source: 'suggestion' });
    if (res.ok) {
      this.motion.clear();
      this.suggestionSpoken = null;
      this.refreshDerived(this.deps.clock());
    }
    return res;
  }

  dismissSuggestion(): void {
    this.motion.dismiss();
    this.refreshDerived(this.deps.clock());
  }

  /** Corrections are new events: the original stays in the log. */
  async correct(targetSeq: number, reason: string, change: { void: true } | { state: DriverState; at: number; restLocation?: RestLocation }): Promise<ActionResult> {
    const blocked = this.gate();
    if (blocked) return blocked;
    try {
      if ('void' in change) await this.append('correction', { targetSeq, reason, void: true });
      else {
        const replacement: NonNullable<NewEvent<'correction'>['payload']['replacement']> = { state: change.state, at: new Date(change.at).toISOString() };
        if (change.state === 'rest') replacement.restLocation = change.restLocation ?? 'stationary_out_of_vehicle';
        await this.append('correction', { targetSeq, reason, replacement });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', message: (e as Error).message };
    }
  }

  verifyIntegrity(): Promise<VerifyResult> {
    return this.deps.store.verify();
  }

  // ---- derived state ----
  private async applyEvents(events: StoredEvent[]): Promise<void> {
    const profiles = profileHistory(events);
    const entries = projectEntries(events);
    this.ctx = buildContext(profiles);
    const now = this.deps.clock();
    const cur = currentEntry(entries, new Date(now).toISOString());
    this.set({
      events,
      entries,
      profiles,
      profile: profiles[profiles.length - 1]?.profile ?? null,
      state: cur?.state ?? null,
      stateSinceMs: cur ? Date.parse(cur.at) : null,
    });
    this.episode = '';
    this.warnings.reset();
    this.slotsAtMs = 0;
    this.refreshDerived(now);
    await this.refreshForecast();
  }

  /**
   * Fast tier first (short-period limits, painted straight away), then the 7/14 day limits, which are slower.
   * A generation counter drops results that were overtaken by a newer log entry.
   */
  private async refreshForecast(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) {
      this.set({ forecast: null, countdownSec: null, limitLabel: '', restToClearMin: null, breaches: [], evaluationKind: null });
      return;
    }
    const gen = ++this.generation;
    const yieldToUi = this.deps.yieldToUi ?? (() => new Promise<void>((r) => setTimeout(r, 0)));
    await yieldToUi();
    if (gen !== this.generation) return;
    const nowMs = this.deps.clock();
    const nowIso = new Date(nowMs).toISOString();
    const entries = this.snap.entries;
    const tiers = tierContexts(ctx);
    const evaluation = runEvaluate(entries, ctx, nowIso);
    const weekAgo = new Date(nowMs - 7 * 86_400_000).toISOString();
    const breaches = evaluation.breaches
      .filter((b) => b.windowStart >= weekAgo)
      .sort((a, b) => (a.windowEnd < b.windowEnd ? 1 : -1))
      .slice(0, 5);
    const fast = runForecast(entries, tiers.fast, nowIso, tiers.slow ? FAST_HISTORY_DAYS : 17);
    this.forecastAtMs = nowMs;
    this.publishForecast(ctx, fast, breaches, evaluation.status.kind);
    if (!tiers.slow) return;
    await yieldToUi();
    if (gen !== this.generation) return;
    const slow = runForecast(entries, tiers.slow, nowIso, 17);
    if (gen !== this.generation) return;
    this.publishForecast(ctx, mergeForecasts(fast, slow), breaches, evaluation.status.kind);
  }

  private publishForecast(ctx: EvaluationContext, forecast: Forecast, breaches: Breach[], kind: Snapshot['evaluationKind']): void {
    this.set({ forecast, limitLabel: limitLabel(ctx, forecast.earliest), restToClearMin: forecast.minimumRestToClear, breaches, evaluationKind: kind });
    this.refreshDerived(this.deps.clock());
  }

  /**
   * Called about once a second by the UI. Updates the countdown from the last forecast (while working the
   * forecast assumes continuous work, so the remaining time falls one-for-one), fires warnings, and refreshes
   * the forecast when it has gone stale.
   */
  tick(): void {
    const now = this.deps.clock();
    this.refreshDerived(now);
    const needsRefresh = this.forecastAtMs !== null && this.snap.state !== 'work' && now - this.forecastAtMs >= FORECAST_REFRESH_WHEN_RESTING_MS;
    if (needsRefresh) void this.refreshForecast();
  }

  private refreshDerived(now: number): void {
    const speed = this.currentSpeed(now);
    const f = this.snap.forecast;
    let countdownSec: number | null = null;
    if (f && f.minutesToEarliest !== null && this.forecastAtMs !== null) {
      const elapsed = this.snap.state === 'work' ? (now - this.forecastAtMs) / 1000 : 0;
      countdownSec = Math.max(0, Math.round(f.minutesToEarliest * 60 - elapsed));
    }
    let banner = this.snap.banner;
    if (this.snap.state !== 'work') banner = null;
    else if (f?.earliest && countdownSec !== null) {
      const ep = `${f.earliest.ruleId}|${f.earliest.kind}|${f.earliest.requirementId ?? ''}|${this.snap.stateSinceMs}`;
      if (ep !== this.episode) {
        this.episode = ep;
        banner = null;
      }
      const fire = this.warnings.check(ep, countdownSec / 60, this.snap.limitLabel);
      if (fire) {
        this.deps.speech.speak(fire.text);
        banner = { level: bannerLevel(fire.threshold), text: fire.threshold <= 0 ? 'Limit reached. Rest now.' : `${fire.threshold} min to required rest`, detail: this.snap.limitLabel, threshold: fire.threshold };
      }
    }
    const slotsDue = now - this.slotsAtMs >= SLOTS_REFRESH_MS || this.snap.slots.length === 0;
    const patch: Partial<Snapshot> = {
      nowMs: now,
      speedKmh: speed,
      interactionAllowed: isInteractionAllowed(speed),
      countdownSec,
      banner,
      suggestion: this.motion.suggestion,
    };
    if (slotsDue && this.snap.profile) {
      patch.slots = buildTodaySlots(toWorkRestEvents(this.snap.entries, new Date(now).toISOString()), this.snap.profile.baseTimeZone, now);
      this.slotsAtMs = now;
    }
    this.set(patch);
  }
}
