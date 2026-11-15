import type { LongNightDefinition, RuleDefinition } from '@logm8/shared';
import { type Interval, type Timeline, WORK, workIn } from './timeline.js';
import { localDayOf, localToEpoch } from './time.js';
import { windowStarts } from './windows.js';

/**
 * Long/night work time (BFM; Fatigue Reg s3 as in force before 1 Aug 2026): any work time
 *  (a) in excess of 12 hours in a 24 hour period, or
 *  (b) between midnight and 6 am (base time zone, HVNL s248).
 * Long and night work are counted together as one set of minutes, so nothing is double counted.
 *
 * "In excess of 12 hours" is applied chronologically: within each 24 h period (counted per HVNL s247 from
 * the scheme's 24 h rule), the work after the first 12 hours of work is long work. See DECISIONS.md.
 */
export function longNightMask(tl: Timeline, def: LongNightDefinition, dailyRule: RuleDefinition): Uint8Array {
  const mask = new Uint8Array(tl.states.length);
  const n = tl.states.length;
  if (n === 0) return mask;
  // (b) night work
  const d0 = localDayOf(tl.timeZone, tl.t0) - 1;
  const d1 = localDayOf(tl.timeZone, tl.end) + 1;
  for (let d = d0; d <= d1; d++) {
    const a = Math.max(0, localToEpoch(tl.timeZone, d, def.nightFrom) - tl.t0);
    const b = Math.min(n, localToEpoch(tl.timeZone, d, def.nightTo) - tl.t0);
    for (let i = a; i < b; i++) if (tl.states[i] === WORK) mask[i] = 1;
  }
  // (a) long work: work beyond the threshold within each 24 h period
  for (const s of windowStarts(tl, dailyRule)) {
    const e = Math.min(tl.end, s + dailyRule.period);
    if (workIn(tl, s, e) <= def.dailyThreshold) continue;
    let acc = 0;
    for (let i = s - tl.t0; i < e - tl.t0; i++) {
      if (tl.states[i] !== WORK) continue;
      acc++;
      if (acc > def.dailyThreshold) mask[i] = 1;
    }
  }
  return mask;
}

/** Long/night minutes in [a, b): each continuous run is rounded up to `roundUpTo` minutes. */
export function longNightIn(tl: Timeline, mask: Uint8Array, def: LongNightDefinition, a: number, b: number): { minutes: number; runs: Interval[] } {
  const runs: Interval[] = [];
  const i0 = Math.max(0, a - tl.t0);
  const i1 = Math.min(mask.length, b - tl.t0);
  let runStart = -1;
  for (let i = i0; i <= i1; i++) {
    const on = i < i1 && mask[i] === 1;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      runs.push({ start: tl.t0 + runStart, end: tl.t0 + i });
      runStart = -1;
    }
  }
  const r = def.roundUpTo;
  const minutes = runs.reduce((sum, run) => sum + Math.ceil((run.end - run.start) / r) * r, 0);
  return { minutes, runs };
}
