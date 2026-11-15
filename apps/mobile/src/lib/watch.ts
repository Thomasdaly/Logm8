import type { RestLocation } from '@logm8/rules-engine';
import type { DriverState } from './types';
import { WARNING_THRESHOLDS } from './warnings';

/**
 * Phone <-> Apple Watch protocol (WatchConnectivity).
 *
 * The phone is the only record keeper. The watch never writes to the event store: it sends a command, the phone
 * applies the same checks as the on-screen buttons (driving lock, setup finished, not already in that state),
 * records the event with the phone's clock and GPS, and replies with the result. See DECISIONS.md (Apple Watch).
 */

export const WATCH_PROTOCOL_VERSION = 1;

/** Rest places the watch may offer. Mirrors the home screen list. */
export const WATCH_REST_PLACES: ReadonlyArray<{ value: RestLocation; label: string; twoUpOnly?: boolean }> = [
  { value: 'stationary_out_of_vehicle', label: 'Out of vehicle' },
  { value: 'sleeper_berth_stationary', label: 'Sleeper (parked)' },
  { value: 'sleeper_berth_moving', label: 'Sleeper (moving)', twoUpOnly: true },
  { value: 'in_vehicle_other', label: 'In vehicle' },
];

/** State pushed to the watch (applicationContext: the latest one always wins, delivered when the watch wakes). */
export interface WatchContext {
  v: number;
  /** Phone time this context was built (epoch ms). */
  sentAtMs: number;
  setupDone: boolean;
  state: DriverState | null;
  restLocation: RestLocation | null;
  stateSinceMs: number | null;
  /**
   * Epoch ms at which the earliest limit is reached if the driver keeps working. Only set while working:
   * the watch schedules its own haptic alerts from it, so they still fire when the phone is out of reach.
   */
  limitAtMs: number | null;
  limitLabel: string;
  /** Minutes before limitAtMs at which the watch alerts (SPEC §5: 60/30/15/5) plus 0 = limit reached. */
  alertMinutes: number[];
  /** Mirrors isInteractionAllowed(speed) on the phone. The phone enforces it again on every command. */
  interactionAllowed: boolean;
  restPlaces: Array<{ value: RestLocation; label: string }>;
  disclaimer: string;
}

export type WatchCommand = { v: number; id: string; action: 'start_work' } | { v: number; id: string; action: 'start_rest'; restLocation: RestLocation };

export type WatchReply = { id: string; ok: true; context: WatchContext } | { id: string; ok: false; reason: string; message: string };

/** The minimal native surface the controller needs. Null object when no watch is paired. */
export interface WatchPort {
  /** Replaces the context on the watch. */
  updateContext(ctx: WatchContext): void;
  /** Registers the command handler. The handler's result is sent back to the watch as the reply. */
  onCommand(handler: (raw: unknown) => Promise<WatchReply>): () => void;
}

export const WATCH_DISCLAIMER = 'Your Written Work Diary is your legal record.';

export interface WatchContextInput {
  nowMs: number;
  setupDone: boolean;
  twoUp: boolean;
  state: DriverState | null;
  restLocation: RestLocation | null;
  stateSinceMs: number | null;
  countdownSec: number | null;
  limitLabel: string;
  interactionAllowed: boolean;
}

export function buildWatchContext(i: WatchContextInput): WatchContext {
  const working = i.state === 'work' && i.countdownSec !== null;
  return {
    v: WATCH_PROTOCOL_VERSION,
    sentAtMs: i.nowMs,
    setupDone: i.setupDone,
    state: i.state,
    restLocation: i.state === 'rest' ? i.restLocation : null,
    stateSinceMs: i.stateSinceMs,
    limitAtMs: working ? i.nowMs + (i.countdownSec as number) * 1000 : null,
    limitLabel: i.limitLabel,
    alertMinutes: [...WARNING_THRESHOLDS, 0],
    interactionAllowed: i.interactionAllowed,
    restPlaces: WATCH_REST_PLACES.filter((p) => !p.twoUpOnly || i.twoUp).map(({ value, label }) => ({ value, label })),
    disclaimer: WATCH_DISCLAIMER,
  };
}

/**
 * Whether a new context is worth sending. The countdown falls one second per second while working, so a
 * context is only resent when something the watch shows or schedules has really changed. limitAtMs drifts by
 * rounding; a change under 30 s is not resent.
 */
export function contextChanged(prev: WatchContext | null, next: WatchContext): boolean {
  if (!prev) return true;
  if (prev.limitAtMs === null || next.limitAtMs === null) {
    if (prev.limitAtMs !== next.limitAtMs) return true;
  } else if (Math.abs(prev.limitAtMs - next.limitAtMs) >= 30_000) return true;
  return (
    prev.setupDone !== next.setupDone ||
    prev.state !== next.state ||
    prev.restLocation !== next.restLocation ||
    prev.stateSinceMs !== next.stateSinceMs ||
    prev.limitLabel !== next.limitLabel ||
    prev.interactionAllowed !== next.interactionAllowed ||
    prev.restPlaces.length !== next.restPlaces.length
  );
}

const REST_VALUES = new Set<string>(WATCH_REST_PLACES.map((p) => p.value));

/** Validates a message from the watch. Anything unexpected is rejected, never guessed. */
export function parseWatchCommand(raw: unknown): { ok: true; cmd: WatchCommand } | { ok: false; id: string; message: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, id: '', message: 'Invalid message.' };
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  if (r.v !== WATCH_PROTOCOL_VERSION) return { ok: false, id, message: 'Update the LogM8 app on your phone and watch.' };
  if (!id) return { ok: false, id, message: 'Invalid message.' };
  if (r.action === 'start_work') return { ok: true, cmd: { v: WATCH_PROTOCOL_VERSION, id, action: 'start_work' } };
  if (r.action === 'start_rest') {
    if (typeof r.restLocation !== 'string' || !REST_VALUES.has(r.restLocation)) return { ok: false, id, message: 'Unknown rest place.' };
    return { ok: true, cmd: { v: WATCH_PROTOCOL_VERSION, id, action: 'start_rest', restLocation: r.restLocation as RestLocation } };
  }
  return { ok: false, id, message: 'Unknown action.' };
}

export const noWatch: WatchPort = {
  updateContext: () => undefined,
  onCommand: () => () => undefined,
};
