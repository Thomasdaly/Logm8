import type { EvaluationContext, RecordingMode, RestLocation, SchemeDefinition, WorkRestEvent } from '../src/index.js';

/** Base date for tests: Monday 16 November 2026 (base-local). */
export const BASE_Y = 2026;
export const BASE_M = 11;
export const BASE_D = 16;

/** UTC ISO instant for local wall time `hh:mm` on `BASE + day` at a fixed UTC offset (hours). */
export function at(day: number, hhmm: string, offsetHours = 10): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const ms = Date.UTC(BASE_Y, BASE_M - 1, BASE_D + day, h, m) - offsetHours * 3_600_000;
  return new Date(ms).toISOString();
}

export type Step = ['w' | 'r', string, (RestLocation | undefined)?, Partial<WorkRestEvent>?];

/**
 * Build a contiguous schedule in base-local time. Each step runs from the previous end to `until`
 * ('HH:MM'); a time earlier than (or equal to) the previous one rolls over to the next day.
 * Rests default to stationary (out of the vehicle).
 */
export function schedule(start: string, steps: Step[], opts: { day?: number; offsetHours?: number } = {}): WorkRestEvent[] {
  const off = opts.offsetHours ?? 10;
  let day = opts.day ?? 0;
  let prev = start;
  let prevIso = at(day, start, off);
  const toMin = (s: string): number => {
    const [h, m] = s.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  const out: WorkRestEvent[] = [];
  for (const [k, until, loc, extra] of steps) {
    if (toMin(until) <= toMin(prev)) day++;
    const endIso = at(day, until, off);
    const e: WorkRestEvent = k === 'w' ? { start: prevIso, end: endIso, kind: 'work' } : { start: prevIso, end: endIso, kind: 'rest', restLocation: loc ?? 'stationary_out_of_vehicle' };
    out.push({ ...e, ...extra });
    prev = until;
    prevIso = endIso;
  }
  return out;
}

/** Concatenate schedules (they must already be contiguous). */
export function concat(...parts: WorkRestEvent[][]): WorkRestEvent[] {
  return parts.flat();
}

export function ctx(scheme: SchemeDefinition, mode: RecordingMode = 'electronic', baseTimeZone = 'Australia/Brisbane', extra: Partial<EvaluationContext> = {}): EvaluationContext {
  return { baseTimeZone, recordingMode: mode, scheme, ...extra };
}

export const H = 60;
