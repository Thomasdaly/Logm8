import { describe, expect, it } from 'vitest';
import { STANDARD_SOLO, countedTimeline, evaluate } from '../src/index.js';
import type { CountedSegment } from '../src/index.js';
import { at, ctx, schedule } from './helpers.js';

const minutes = (segs: CountedSegment[], kind: CountedSegment['kind']): number =>
  segs.filter((s) => s.kind === kind).reduce((sum, s) => sum + (Date.parse(s.end) - Date.parse(s.start)) / 60000, 0);

function counted(steps: Parameters<typeof schedule>[1], mode: 'written' | 'electronic') {
  const r = countedTimeline(schedule('00:00', steps), ctx(STANDARD_SOLO, mode));
  if (!r.ok) throw new Error(r.errors.join());
  return r.value;
}

describe('Written work diary counting (NHVR "Counting time" tables, Fatigue Reg s19)', () => {
  // Durations from the NHVR tables, starting on a 15-minute boundary of the clock-aligned grid.
  it.each([
    [6, 15],
    [32, 45],
    [2 * 60 + 21, 2 * 60 + 30],
  ])('work of %i min counts as %i min', (actual, expected) => {
    const end = `${String(Math.floor((60 + actual) / 60)).padStart(2, '0')}:${String((60 + actual) % 60).padStart(2, '0')}`;
    const segs = counted([['r', '01:00'], ['w', end], ['r', '08:00']], 'written');
    expect(minutes(segs, 'work')).toBe(expected);
  });

  it.each([
    [12, 0],
    [44, 30],
    [6 * 60 + 40, 6 * 60 + 30],
  ])('rest of %i min counts as %i min', (actual, expected) => {
    const end = `${String(Math.floor((60 + actual) / 60)).padStart(2, '0')}:${String((60 + actual) % 60).padStart(2, '0')}`;
    const segs = counted([['w', '01:00'], ['r', end], ['w', '09:00']], 'written');
    expect(minutes(segs, 'rest_stationary')).toBe(expected);
  });

  it('a 15-minute block that mixes rest kinds counts only as non-stationary rest @unverified(clock-aligned grid)', () => {
    const segs = counted([['w', '01:00'], ['r', '01:05', 'sleeper_berth_moving'], ['r', '01:15'], ['w', '02:00']], 'written');
    expect(segs.find((s) => s.start === at(0, '01:00'))?.kind).toBe('rest_other');
  });
});

describe('Electronic counting (NHVR "Counting time", Fatigue Reg s19A)', () => {
  it.each([6, 32, 141])('work of %i min counts to the minute', (m) => {
    const end = `${String(Math.floor((60 + m) / 60)).padStart(2, '0')}:${String((60 + m) % 60).padStart(2, '0')}`;
    expect(minutes(counted([['r', '01:00'], ['w', end], ['r', '08:00']], 'electronic'), 'work')).toBe(m);
  });

  it('a 13-minute rest does not count towards a minimum rest; a 20-minute rest counts to the minute', () => {
    // 5 1/2 h rule needs 15 continuous minutes rest.
    const short = schedule('22:00', [['r', '06:00'], ['w', '09:00'], ['r', '09:13'], ['w', '11:30'], ['r', '20:00']], { day: -1 });
    const r1 = evaluate(short, ctx(STANDARD_SOLO));
    const b = r1.breaches.find((x) => x.ruleId === 'std-solo-5.5h' && x.kind === 'min_rest' && x.windowStart === at(0, '06:00'));
    expect(b?.actual).toBe(0);

    const ok = schedule('22:00', [['r', '06:00'], ['w', '09:00'], ['r', '09:20'], ['w', '11:30'], ['r', '20:00']], { day: -1 });
    const r2 = evaluate(ok, ctx(STANDARD_SOLO));
    expect(r2.breaches.filter((x) => x.ruleId === 'std-solo-5.5h' && x.windowStart === at(0, '06:00'))).toEqual([]);
  });

  it('three rests of 14, 24 and 22 minutes do not make 60 minutes rest (s19A(4) example)', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '08:00'], ['r', '08:14'], ['w', '10:00'], ['r', '10:24'], ['w', '12:00'], ['r', '12:22'], ['w', '17:30'], ['r', '22:00']], { day: -1 });
    const r = evaluate(ev, ctx(STANDARD_SOLO));
    const b = r.breaches.find((x) => x.ruleId === 'std-solo-11h' && x.kind === 'min_rest' && x.windowStart === at(0, '06:00'));
    expect(b?.actual).toBe(46);
    expect(b?.limit).toBe(60);
  });

  it('seconds are dropped: periods of less than one minute are not counted', () => {
    const ev = [
      { start: '2026-11-15T20:00:00Z', end: '2026-11-15T20:00:40Z', kind: 'work' as const },
      { start: '2026-11-15T20:00:40Z', end: '2026-11-15T21:00:00Z', kind: 'rest' as const, restLocation: 'stationary_out_of_vehicle' as const },
    ];
    const r = countedTimeline(ev, ctx(STANDARD_SOLO));
    expect(r.ok && r.value.map((s) => s.kind)).toEqual(['rest_stationary']);
  });
});
