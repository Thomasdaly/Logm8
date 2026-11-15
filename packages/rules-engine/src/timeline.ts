import type { RecordingMode, WorkRestEvent } from '@logm8/shared';
import { localDayOf, localToEpoch, parseInstant } from './time.js';

/** Per-minute counted state. */
export const NONE = 0; // no record / not counted
export const WORK = 1;
export const REST_STATIONARY = 2; // out of vehicle, or sleeper berth of a stationary vehicle (HVNL s221)
export const REST_SLEEPER_MOVING = 3; // approved sleeper berth while the vehicle is moving
export const REST_OTHER = 4; // any other rest (e.g. in the vehicle, not in a sleeper berth)

export type CountedState = typeof NONE | typeof WORK | typeof REST_STATIONARY | typeof REST_SLEEPER_MOVING | typeof REST_OTHER;

export const SLOT = 15;

/** Half-open interval [start, end) in epoch minutes. */
export interface Interval {
  start: number;
  end: number;
}

export interface NightWindow extends Interval {
  /** Local day number of the evening the window starts on. */
  day: number;
}

export interface Timeline {
  mode: RecordingMode;
  timeZone: string;
  /** Epoch minute of index 0. */
  t0: number;
  /** Exclusive end (epoch minutes) of the counted record. */
  end: number;
  states: Uint8Array;
  /** workPrefix[i] = work minutes in [t0, t0 + i). */
  workPrefix: Int32Array;
  /** Maximal runs of rest of any class (a "rest break"). */
  restBlocks: Interval[];
  /** Maximal runs of stationary rest. */
  stationaryRuns: Interval[];
  /** Maximal runs of sleeper-berth-moving rest. */
  sleeperMovingRuns: Interval[];
  /** Night rest windows 22:00 -> 08:00 base time, covering the record. */
  nightWindows: NightWindow[];
  /** Night work windows (long/night) are computed on demand by the long/night module. */
  firstIsRest: boolean;
  gaps: Interval[];
  unknownRestLocation: boolean;
}

function restState(e: WorkRestEvent): CountedState {
  switch (e.restLocation) {
    case 'stationary_out_of_vehicle':
    case 'sleeper_berth_stationary':
      return REST_STATIONARY;
    case 'sleeper_berth_moving':
      return REST_SLEEPER_MOVING;
    default:
      // 'in_vehicle_other' or unknown: rest time, but not stationary (conservative).
      return REST_OTHER;
  }
}

export interface ParsedEvent {
  start: number;
  end: number;
  state: CountedState;
  source: WorkRestEvent;
}

export type ParseResult = { ok: true; events: ParsedEvent[] } | { ok: false; errors: string[] };

/** Validate and parse events. Events must be chronological and non-overlapping. */
export function parseEvents(events: readonly WorkRestEvent[]): ParseResult {
  const errors: string[] = [];
  const parsed: ParsedEvent[] = [];
  if (!Array.isArray(events)) return { ok: false, errors: ['events must be an array'] };
  events.forEach((e, i) => {
    const start = parseInstant(e.start);
    const end = parseInstant(e.end);
    if (start === null) errors.push(`events[${i}].start is not a valid ISO 8601 instant with a zone: ${String(e.start)}`);
    if (end === null) errors.push(`events[${i}].end is not a valid ISO 8601 instant with a zone: ${String(e.end)}`);
    if (e.kind !== 'work' && e.kind !== 'rest') errors.push(`events[${i}].kind must be 'work' or 'rest'`);
    if (start === null || end === null) return;
    if (end < start) {
      errors.push(`events[${i}] ends before it starts`);
      return;
    }
    if (end === start) return; // sub-minute event: not counted (Fatigue Reg s19A(3))
    parsed.push({ start, end, state: e.kind === 'work' ? WORK : restState(e), source: e });
  });
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const cur = parsed[i];
    if (prev && cur && cur.start < prev.end) {
      errors.push(`events overlap or are out of order at ${cur.source.start}`);
      break;
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, events: parsed };
}

function runsOf(states: Uint8Array, t0: number, pred: (s: number) => boolean): Interval[] {
  const runs: Interval[] = [];
  let runStart = -1;
  for (let i = 0; i <= states.length; i++) {
    const inRun = i < states.length && pred(states[i] ?? NONE);
    if (inRun && runStart < 0) runStart = i;
    if (!inRun && runStart >= 0) {
      runs.push({ start: t0 + runStart, end: t0 + i });
      runStart = -1;
    }
  }
  return runs;
}

const isRest = (s: number): boolean => s === REST_STATIONARY || s === REST_SLEEPER_MOVING || s === REST_OTHER;

/**
 * Written work diary counting (Fatigue Reg s19; NHVR "Counting time"): the daily sheet grid is in
 * 15-minute blocks aligned to the clock. Any work in a block makes the whole block work (work rounds
 * up/outward); a block counts as rest only if it is rest for the whole 15 minutes (rest rounds down/inward).
 * All Australian base-time-zone offsets are whole multiples of 15 minutes, so clock alignment in UTC
 * equals clock alignment in base time.
 */
function applyWrittenRounding(states: Uint8Array): void {
  for (let i = 0; i < states.length; i += SLOT) {
    let anyWork = false;
    let allRest = true;
    let cls: number = -1;
    let mixed = false;
    for (let j = i; j < i + SLOT; j++) {
      const s = states[j] ?? NONE;
      if (s === WORK) anyWork = true;
      if (!isRest(s)) allRest = false;
      else if (cls === -1) cls = s;
      else if (cls !== s) mixed = true;
    }
    // A block mixing rest kinds is counted only as "other" rest (conservative).
    const value = anyWork ? WORK : allRest ? (mixed ? REST_OTHER : cls) : NONE;
    states.fill(value, i, i + SLOT);
  }
}

export interface BuildOptions {
  mode: RecordingMode;
  timeZone: string;
  /** Optional earliest minute to include (events before are clipped). */
  from?: number;
  /** Optional exclusive end (events after are clipped). */
  until?: number;
}

export function buildTimeline(events: readonly ParsedEvent[], opts: BuildOptions): Timeline {
  const first = events[0];
  const last = events[events.length - 1];
  let t0 = first ? first.start : (opts.from ?? 0);
  let end = last ? last.end : t0;
  if (opts.from !== undefined) t0 = Math.max(t0, opts.from);
  if (opts.until !== undefined) end = Math.min(end, opts.until);
  if (end < t0) end = t0;
  if (opts.mode === 'written') {
    t0 = Math.floor(t0 / SLOT) * SLOT;
    end = Math.ceil(end / SLOT) * SLOT;
  }
  const n = end - t0;
  const states = new Uint8Array(n);
  let unknownRestLocation = false;
  for (const e of events) {
    const a = Math.max(e.start, t0);
    const b = Math.min(e.end, opts.until ?? end, end);
    if (b <= a) continue;
    states.fill(e.state, a - t0, b - t0);
    if (e.source.kind === 'rest' && e.source.restLocation === undefined) unknownRestLocation = true;
  }
  if (opts.mode === 'written') applyWrittenRounding(states);

  const workPrefix = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) workPrefix[i + 1] = (workPrefix[i] ?? 0) + (states[i] === WORK ? 1 : 0);

  const nightWindows: NightWindow[] = [];
  if (n > 0) {
    const d0 = localDayOf(opts.timeZone, t0) - 1;
    const d1 = localDayOf(opts.timeZone, end) + 1;
    for (let d = d0; d <= d1; d++) {
      nightWindows.push({ day: d, start: localToEpoch(opts.timeZone, d, 22 * 60), end: localToEpoch(opts.timeZone, d + 1, 8 * 60) });
    }
  }

  return {
    mode: opts.mode,
    timeZone: opts.timeZone,
    t0,
    end,
    states,
    workPrefix,
    restBlocks: runsOf(states, t0, isRest),
    stationaryRuns: runsOf(states, t0, (s) => s === REST_STATIONARY),
    sleeperMovingRuns: runsOf(states, t0, (s) => s === REST_SLEEPER_MOVING),
    nightWindows,
    firstIsRest: n > 0 && isRest(states[0] ?? NONE),
    gaps: runsOf(states, t0, (s) => s === NONE),
    unknownRestLocation,
  };
}

/** Work minutes counted in [a, b) (clamped to the record). */
export function workIn(tl: Timeline, a: number, b: number): number {
  const i = Math.max(0, Math.min(tl.states.length, a - tl.t0));
  const j = Math.max(0, Math.min(tl.states.length, b - tl.t0));
  if (j <= i) return 0;
  return (tl.workPrefix[j] ?? 0) - (tl.workPrefix[i] ?? 0);
}

/** Intervals clipped to [a, b), dropping empties. Input must be sorted and disjoint. */
export function clipRuns(runs: readonly Interval[], a: number, b: number): Interval[] {
  const out: Interval[] = [];
  // binary search the first run with end > a
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((runs[mid]?.end ?? 0) <= a) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < runs.length; i++) {
    const r = runs[i];
    if (!r || r.start >= b) break;
    const s = Math.max(r.start, a);
    const e = Math.min(r.end, b);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

export function len(i: Interval): number {
  return i.end - i.start;
}

/** Local day numbers of night rest breaks (HVNL s5) available within [a, b). */
export function nightRestDays(tl: Timeline, a: number, b: number): Set<number> {
  const days = new Set<number>();
  for (const run of clipRuns(tl.stationaryRuns, a, b)) {
    let found = false;
    for (const nw of tl.nightWindows) {
      if (nw.end <= run.start || nw.start >= run.end) continue;
      const overlap = Math.min(nw.end, run.end) - Math.max(nw.start, run.start);
      if (overlap >= 420) {
        days.add(nw.day);
        found = true;
      }
    }
    // (b) 24 continuous hours stationary rest time is also a night rest break.
    if (!found && len(run) >= 1440) days.add(localDayOf(tl.timeZone, run.start));
  }
  return days;
}

/** Counted segments, merged, for display and tests. */
export function segments(tl: Timeline): Array<Interval & { state: CountedState }> {
  const out: Array<Interval & { state: CountedState }> = [];
  for (let i = 0; i < tl.states.length; i++) {
    const s = (tl.states[i] ?? NONE) as CountedState;
    const lastSeg = out[out.length - 1];
    if (lastSeg && lastSeg.state === s && lastSeg.end === tl.t0 + i) lastSeg.end++;
    else out.push({ start: tl.t0 + i, end: tl.t0 + i + 1, state: s });
  }
  return out;
}

export { parseInstant };
