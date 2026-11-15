import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_SCHEMES, countedTimeline, evaluate, forecast } from '../src/index.js';
import type { EvaluationContext, RecordingMode, RestLocation, WorkRestEvent } from '../src/index.js';

const START = Date.UTC(2026, 10, 15, 20, 0); // 06:00 Brisbane, 16 Nov 2026
const LOCATIONS: Array<RestLocation | undefined> = ['stationary_out_of_vehicle', 'sleeper_berth_stationary', 'sleeper_berth_moving', 'in_vehicle_other', undefined];

const segmentArb = fc.record({
  kind: fc.constantFrom<'work' | 'rest'>('work', 'rest'),
  minutes: fc.oneof(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 6 * 60 }), fc.integer({ min: 6 * 60, max: 30 * 60 })),
  loc: fc.constantFrom(...LOCATIONS),
});

const scheduleArb = fc.array(segmentArb, { minLength: 0, maxLength: 40 });
const ctxArb = fc.record({
  scheme: fc.constantFrom(...BUILT_IN_SCHEMES),
  recordingMode: fc.constantFrom<RecordingMode>('written', 'electronic'),
  baseTimeZone: fc.constantFrom('Australia/Brisbane', 'Australia/Sydney', 'Australia/Adelaide', 'Australia/Hobart'),
});

function toEvents(segs: Array<{ kind: 'work' | 'rest'; minutes: number; loc: RestLocation | undefined }>): WorkRestEvent[] {
  let t = START;
  return segs.map((s) => {
    const start = new Date(t).toISOString();
    t += s.minutes * 60_000;
    const e: WorkRestEvent = { start, end: new Date(t).toISOString(), kind: s.kind };
    if (s.kind === 'rest' && s.loc) e.restLocation = s.loc;
    return e;
  });
}

const endOf = (ev: WorkRestEvent[]): number => (ev.length > 0 ? Date.parse(ev[ev.length - 1]!.end) : START);

describe('Property-based tests (fast-check)', () => {
  it('random valid schedules never crash evaluate() and always produce a definite status', () => {
    fc.assert(
      fc.property(scheduleArb, ctxArb, (segs, c) => {
        const r = evaluate(toEvents(segs), c as EvaluationContext);
        expect(['compliant', 'breach']).toContain(r.status.kind);
        expect(r.status.kind === 'breach').toBe(r.breaches.length > 0);
        for (const b of r.breaches) {
          if (b.kind === 'max_work' || b.kind === 'max_long_night') expect(b.actual).toBeGreaterThan(b.limit);
          if (b.kind === 'min_rest') expect(b.actual).toBeLessThan(b.limit);
          expect(Date.parse(b.windowEnd)).toBeGreaterThan(Date.parse(b.windowStart));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('random valid schedules never crash forecast()', () => {
    fc.assert(
      fc.property(fc.array(segmentArb, { maxLength: 12 }), ctxArb, (segs, c) => {
        const ev = toEvents(segs);
        const f = forecast(ev, c as EvaluationContext, new Date(endOf(ev)).toISOString());
        expect(f.status).toBe('ok');
        expect(f.minutesToEarliest === null || f.minutesToEarliest >= 0).toBe(true);
        if (f.earliest) expect(f.minutesToEarliest).toBe(f.earliest.minutesUntilBreach);
      }),
      { numRuns: 25 },
    );
  });

  it('adding work never reduces the breach count', () => {
    fc.assert(
      fc.property(scheduleArb, ctxArb, fc.integer({ min: 1, max: 20 * 60 }), (segs, c, extra) => {
        const ev = toEvents(segs);
        const t = endOf(ev);
        const more = [...ev, { start: new Date(t).toISOString(), end: new Date(t + extra * 60_000).toISOString(), kind: 'work' as const }];
        const before = evaluate(ev, c as EvaluationContext).breaches.length;
        const after = evaluate(more, c as EvaluationContext).breaches.length;
        expect(after).toBeGreaterThanOrEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it('written-diary counting never records less work than electronic counting (work rounds up)', () => {
    fc.assert(
      fc.property(scheduleArb, (segs) => {
        const ev = toEvents(segs);
        const work = (mode: RecordingMode): number => {
          const r = countedTimeline(ev, { baseTimeZone: 'Australia/Brisbane', recordingMode: mode, scheme: BUILT_IN_SCHEMES[0]! });
          if (!r.ok) throw new Error('unexpected');
          return r.value.filter((s) => s.kind === 'work').reduce((sum, s) => sum + Date.parse(s.end) - Date.parse(s.start), 0);
        };
        expect(work('written')).toBeGreaterThanOrEqual(work('electronic'));
      }),
      { numRuns: 200 },
    );
  });

  it('evaluate() is deterministic', () => {
    fc.assert(
      fc.property(scheduleArb, ctxArb, (segs, c) => {
        const ev = toEvents(segs);
        expect(evaluate(ev, c as EvaluationContext)).toEqual(evaluate(ev, c as EvaluationContext));
      }),
      { numRuns: 50 },
    );
  });
});
