/**
 * SPEC §4.6 required test cases. Each case is a separately named test.
 * Expected outcomes are exactly as stated in SPEC §4.6 (none were changed).
 */
import { describe, expect, it } from 'vitest';
import {
  BFM_SOLO,
  BFM_TWO_UP,
  STANDARD_SOLO,
  STANDARD_TWO_UP,
  countedTimeline,
  evaluate,
  forecast,
  longNightMinutes,
  nightRestBreakDates,
} from '../src/index.js';
import type { Breach, WorkRestEvent } from '../src/index.js';
import { H, at, concat, ctx, schedule } from './helpers.js';

const byRule = (bs: Breach[], ruleId: string, kind?: Breach['kind']): Breach[] => bs.filter((b) => b.ruleId === ruleId && (!kind || b.kind === kind));

describe('SPEC §4.6 required cases', () => {
  it('1. 8-hour limit (Standard solo): 7h45 work in the 8 h period from 06:00 is a breach; a single 15-min break does not reset the period', () => {
    const events = schedule('22:00', [['r', '06:00'], ['w', '11:15'], ['r', '11:30'], ['w', '14:00']], { day: -1 });
    for (const mode of ['written', 'electronic'] as const) {
      const r = evaluate(events, ctx(STANDARD_SOLO, mode));
      const b = byRule(r.breaches, 'std-solo-8h', 'max_work').find((x) => x.windowStart === at(0, '06:00'));
      expect(b, mode).toBeDefined();
      expect(b?.actual).toBe(7 * H + 45);
      expect(b?.limit).toBe(7 * H + 30);
      expect(b?.windowEnd).toBe(at(0, '14:00'));
      expect(b?.severity).toBe('minor');
      expect(r.status.kind).toBe('breach');
    }
  });

  it('2. Rounding (written): work 06:07-10:02 records as 06:00-10:15; rest 10:02-10:37 credits only 10:15-10:30 @unverified(clock-aligned grid)', () => {
    const events = schedule('00:00', [['r', '06:07'], ['w', '10:02'], ['r', '10:37'], ['w', '11:00']]);
    const t = countedTimeline(events, ctx(STANDARD_SOLO, 'written'));
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.value).toEqual([
      { start: at(0, '00:00'), end: at(0, '06:00'), kind: 'rest_stationary' },
      { start: at(0, '06:00'), end: at(0, '10:15'), kind: 'work' },
      { start: at(0, '10:15'), end: at(0, '10:30'), kind: 'rest_stationary' },
      { start: at(0, '10:30'), end: at(0, '11:00'), kind: 'work' },
    ]);
  });

  it('3. 11-hour limit: 9 h driving + 3 h loading/inspection = 12 h work; all work counts, so the 11 h period is breached', () => {
    const drive = { activity: 'driving' } as const;
    const other = { activity: 'other_work' } as const;
    const events = schedule(
      '22:00',
      [
        ['r', '06:00'],
        ['w', '09:00', undefined, drive],
        ['r', '09:15'],
        ['w', '10:15', undefined, other],
        ['w', '13:15', undefined, drive],
        ['r', '13:30'],
        ['w', '14:30', undefined, other],
        ['w', '17:30', undefined, drive],
        ['r', '17:45'],
        ['w', '18:45', undefined, other],
        ['r', '06:00'],
      ],
      { day: -1 },
    );
    const work = (pred: (e: WorkRestEvent) => boolean): number =>
      events.filter((e) => e.kind === 'work' && pred(e)).reduce((s, e) => s + (Date.parse(e.end) - Date.parse(e.start)) / 60000, 0);
    expect(work((e) => e.activity === 'driving')).toBe(9 * H);
    expect(work((e) => e.activity === 'other_work')).toBe(3 * H);

    const r = evaluate(events, ctx(STANDARD_SOLO));
    const b = byRule(r.breaches, 'std-solo-11h', 'max_work').find((x) => x.windowStart === at(0, '06:00'));
    expect(b).toBeDefined();
    // 06:00-17:00 contains 10h30 of work (driving alone would be only 8h30 - under the limit).
    expect(b?.actual).toBe(10 * H + 30);
    expect(b?.limit).toBe(10 * H);
  });

  describe('4. 24-hour overlap (Standard solo)', () => {
    const day = schedule(
      '22:00',
      [['r', '06:00'], ['w', '11:15'], ['r', '11:30'], ['w', '13:45'], ['r', '15:15'], ['w', '19:45'], ['r', '02:45']],
      { day: -1 },
    );
    const c = ctx(STANDARD_SOLO);

    it('4a. 12 h reached at 19:45: restarting at 02:45 when the 7 h rest ends creates an overlapping period and breaches', () => {
      const events = concat(day, schedule('02:45', [['w', '06:00']], { day: 1 }));
      const r = evaluate(events, c);
      const b = byRule(r.breaches, 'std-solo-24h', 'max_work').find((x) => x.windowStart === at(0, '06:00'));
      expect(b).toBeDefined();
      expect(b?.actual).toBe(12 * H + 3 * H + 15);
      expect(b?.windowEnd).toBe(at(1, '06:00'));
    });

    it('4b. the earliest compliant restart is 06:00 the next day', () => {
      const ok = evaluate(concat(day, schedule('02:45', [['r', '06:00'], ['w', '08:00']], { day: 1 })), c);
      expect(byRule(ok.breaches, 'std-solo-24h')).toEqual([]);
      const f = forecast(day, c, at(1, '02:45'));
      expect(f.status).toBe('ok');
      expect(f.earliest?.ruleId).toBe('std-solo-24h');
      expect(f.minutesToEarliest).toBe(0);
      expect(f.minimumRestToClear).toBe(3 * H + 15);
      expect(f.earliestRestart).toBe(at(1, '06:00'));
    });
  });

  it('5. Long/night 1: BFM solo, 13 h work between 06:00 and 23:00 = 1 h long/night', () => {
    const events = schedule(
      '23:00',
      [['r', '06:00'], ['w', '11:45'], ['r', '12:45'], ['w', '18:30'], ['r', '19:30'], ['w', '21:00'], ['r', '07:00']],
      { day: -1 },
    );
    const c = ctx(BFM_SOLO);
    const ln = longNightMinutes(events, c, at(-1, '00:00'), at(6, '00:00'));
    expect(ln).toEqual({ ok: true, value: 1 * H });
    expect(evaluate(events, c).breaches).toEqual([]);
  });

  it('6. Long/night 2: BFM solo, 14 h work 13:00 -> 06:00 including 00:00-06:00 = 6 h long/night (no double count)', () => {
    const events = schedule('06:00', [['r', '13:00'], ['w', '17:30'], ['r', '19:00'], ['w', '22:30'], ['r', '00:00'], ['w', '06:00'], ['r', '14:00']]);
    const total = events.filter((e) => e.kind === 'work').reduce((s, e) => s + (Date.parse(e.end) - Date.parse(e.start)) / 60000, 0);
    expect(total).toBe(14 * H);
    const ln = longNightMinutes(events, ctx(BFM_SOLO), at(0, '00:00'), at(7, '00:00'));
    expect(ln).toEqual({ ok: true, value: 6 * H });
  });

  describe('7. Long/night rounding', () => {
    for (const mode of ['electronic', 'written'] as const) {
      it(`7a. (${mode}) 53 min over 12 h counts as 1 h`, () => {
        const events = schedule('22:00', [['r', '06:00'], ['w', '11:00'], ['r', '12:00'], ['w', '19:53'], ['r', '08:00']], { day: -1 });
        expect(longNightMinutes(events, ctx(BFM_SOLO, mode), at(-1, '00:00'), at(6, '00:00'))).toEqual({ ok: true, value: 1 * H });
      });
      it(`7b. (${mode}) 141 min between 00:00 and 03:00 counts as 2 1/2 h`, () => {
        const events = schedule('15:00', [['r', '00:00'], ['w', '02:21'], ['r', '10:00']], { day: -1 });
        expect(longNightMinutes(events, ctx(BFM_SOLO, mode), at(-1, '00:00'), at(6, '00:00'))).toEqual({ ok: true, value: 2 * H + 30 });
      });
    }
  });

  describe('8. 36 h cap (BFM solo)', () => {
    // Night shifts 00:00-03:00, 15 min rest, 03:15-06:00 => 5h45 of night work each.
    const nights = (n: number, startDay = 0): WorkRestEvent[] =>
      Array.from({ length: n }, (_, i) => schedule('00:00', [['w', '03:00'], ['r', '03:15'], ['w', '06:00'], ['r', '00:00']], { day: startDay + i })).flat();
    const lead = schedule('14:00', [['r', '00:00']], { day: -1 });
    const c = ctx(BFM_SOLO);

    it('8a. six nights (34 1/2 h long/night) are within the cap', () => {
      const r = evaluate(concat(lead, nights(6)), c);
      expect(byRule(r.breaches, 'bfm-solo-7d')).toEqual([]);
    });

    it('8b. reaching 36 h: further long/night work in the 7 days is flagged, until the total drops below 36 h', () => {
      // 7 nights, then a 66 h rest, then another night shift on day 9.
      const tailRest = schedule('06:00', [['r', '00:00']], { day: 6 });
      tailRest[0] = { ...tailRest[0]!, end: at(9, '00:00') };
      const events = concat(lead, nights(6), schedule('00:00', [['w', '03:00'], ['r', '03:15'], ['w', '06:00']], { day: 6 }), tailRest, schedule('00:00', [['w', '03:00'], ['r', '10:00']], { day: 9 }));
      const r = evaluate(events, c);
      const ln = byRule(r.breaches, 'bfm-solo-7d', 'max_long_night');
      expect(ln.map((b) => b.windowStart).sort()).toEqual([at(0, '00:00'), at(0, '03:15')]);
      const first = ln.find((b) => b.windowStart === at(0, '00:00'));
      expect(first?.actual).toBe(7 * (5 * H + 45));
      expect(first?.limit).toBe(36 * H);
      // The day-9 shift is not in breach: every 7-day period containing it has < 36 h long/night.
      expect(ln.every((b) => Date.parse(b.windowStart) < Date.parse(at(1, '00:00')))).toBe(true);
    });

    it('8c. forecast at the start of night 7: 90 min until the cap; then only non-night work may resume (06:00)', () => {
      const f = forecast(concat(lead, nights(6)), c, at(6, '00:00'));
      expect(f.earliest?.ruleId).toBe('bfm-solo-7d');
      expect(f.earliest?.kind).toBe('max_long_night');
      expect(f.minutesToEarliest).toBe(90);
      expect(f.earliestRestart).toBe(at(6, '06:00'));
    });
  });

  it('9. Night rest: 7 h stationary 23:00-06:00 counts; 21:00-04:00 does not; a 24 h rest always counts', () => {
    const c = ctx(STANDARD_SOLO);
    const dates = (ev: WorkRestEvent[]): string[] => {
      const r = nightRestBreakDates(ev, c);
      return r.ok ? r.value : ['error'];
    };
    expect(dates(schedule('20:00', [['w', '23:00'], ['r', '06:00'], ['w', '08:00']]))).toEqual(['2026-11-16']);
    expect(dates(schedule('18:00', [['w', '21:00'], ['r', '04:00'], ['w', '08:00']]))).toEqual([]);
    expect(dates(schedule('08:00', [['w', '10:00'], ['r', '10:00'], ['w', '12:00']]))).toEqual(['2026-11-16']);
    // Rest in the vehicle (not stationary rest time) is not a night rest break.
    expect(dates(schedule('20:00', [['w', '23:00'], ['r', '06:00', 'in_vehicle_other'], ['w', '08:00']]))).toEqual([]);
  });

  it('10. Sleeper berth (two-up): 5 h sleeper-berth-moving rest satisfies the 24 h rule but is not stationary rest for the 52 h rule', () => {
    const SM = 'sleeper_berth_moving' as const;
    const dayPattern: Array<['w' | 'r', string, typeof SM?]> = [['w', '11:00'], ['r', '12:00', SM], ['w', '17:00'], ['r', '19:00', SM], ['w', '21:00'], ['r', '06:00', SM]];
    const events = schedule('00:00', [['r', '06:00', SM], ...dayPattern, ...dayPattern, ...dayPattern]);
    const r = evaluate(events, ctx(STANDARD_TWO_UP));
    expect(byRule(r.breaches, 'std-two-24h')).toEqual([]);
    const b52 = byRule(r.breaches, 'std-two-52h', 'min_rest');
    expect(b52.length).toBeGreaterThan(0);
    expect(b52[0]?.actual).toBe(0);
    expect(r.breaches.every((b) => b.ruleId === 'std-two-52h')).toBe(true);
  });

  it('11. Time zone: QLD-based driver working in NSW during daylight saving - all windows are computed in Brisbane time', () => {
    // Events written against the Sydney (AEDT, UTC+11) clock, tagged NSW.
    const nsw = (ev: WorkRestEvent[]): WorkRestEvent[] => ev.map((e) => ({ ...e, jurisdiction: 'NSW' as const }));
    // Rest 22:00-05:00 Sydney time = 21:00-04:00 Brisbane time.
    const rest = nsw(schedule('18:00', [['w', '22:00'], ['r', '05:00'], ['w', '08:00']], { offsetHours: 11 }));
    const qld = nightRestBreakDates(rest, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane'));
    const syd = nightRestBreakDates(rest, ctx(STANDARD_SOLO, 'electronic', 'Australia/Sydney'));
    expect(qld).toEqual({ ok: true, value: [] });
    expect(syd).toEqual({ ok: true, value: ['2026-11-16'] });

    // Work 23:00-01:00 Sydney time = 22:00-00:00 Brisbane time: no night work in base time.
    const work = nsw(schedule('15:00', [['r', '23:00'], ['w', '01:00'], ['r', '10:00']], { offsetHours: 11 }));
    expect(longNightMinutes(work, ctx(BFM_SOLO, 'electronic', 'Australia/Brisbane'), at(0, '00:00'), at(3, '00:00'))).toEqual({ ok: true, value: 0 });
    expect(longNightMinutes(work, ctx(BFM_SOLO, 'electronic', 'Australia/Sydney'), at(0, '00:00'), at(3, '00:00'))).toEqual({ ok: true, value: 60 });

    // Counting windows are anchored to the real instants (24 h = 1440 minutes) regardless of local DST.
    const r = evaluate(rest, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane'));
    expect(r.status.kind).not.toBe('unsupported_jurisdiction');
  });

  describe('12. Forecast: minutes to the earliest binding limit, one case per scheme', () => {
    it('12a. Standard solo: 4 h worked since rest -> 75 min to the 5 1/2 h limit; 15 min rest clears it', () => {
      const ev = schedule('22:00', [['r', '06:00'], ['w', '10:00']], { day: -1 });
      const f = forecast(ev, ctx(STANDARD_SOLO), at(0, '10:00'));
      expect(f.earliest?.ruleId).toBe('std-solo-5.5h');
      expect(f.minutesToEarliest).toBe(75);
      expect(f.minimumRestToClear).toBe(15);
      expect(f.earliestRestart).toBe(at(0, '11:30'));
    });
    it('12b. Standard two-up: 4 1/2 h worked -> 45 min', () => {
      const ev = schedule('22:00', [['r', '06:00'], ['w', '10:30']], { day: -1 });
      const f = forecast(ev, ctx(STANDARD_TWO_UP), at(0, '10:30'));
      expect(f.earliest?.ruleId).toBe('std-two-5.5h');
      expect(f.minutesToEarliest).toBe(45);
    });
    it('12c. BFM solo: 5 h worked -> 60 min to the 6 1/4 h limit', () => {
      const ev = schedule('22:00', [['r', '06:00'], ['w', '11:00']], { day: -1 });
      const f = forecast(ev, ctx(BFM_SOLO), at(0, '11:00'));
      expect(f.earliest?.ruleId).toBe('bfm-solo-6.25h');
      expect(f.minutesToEarliest).toBe(60);
      expect(f.minimumRestToClear).toBe(15);
    });
    it('12d. BFM two-up: 13 h worked in 24 h -> 60 min to the 14 h limit', () => {
      const ev = schedule('20:00', [['r', '06:00'], ['w', '12:00'], ['r', '13:00', 'sleeper_berth_moving'], ['w', '20:00']], { day: -1 });
      const f = forecast(ev, ctx(BFM_TWO_UP), at(0, '20:00'));
      expect(f.earliest?.ruleId).toBe('bfm-two-24h');
      expect(f.minutesToEarliest).toBe(60);
    });
  });

  describe('13. Scheme switch', () => {
    const lead = schedule('20:00', [['r', '06:00']], { day: -1 });
    const longDay = schedule('06:00', [['w', '11:00'], ['r', '11:30'], ['w', '16:30'], ['r', '17:00'], ['w', '22:00']]); // 15 h work

    it('13a. Standard -> BFM without a 48 h reset and without full BFM compliance is flagged', () => {
      const events = concat(lead, longDay, schedule('22:00', [['r', '08:00'], ['w', '12:00']]));
      const r = evaluate(events, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: at(1, '07:00'), scheme: BFM_SOLO }] }));
      const sw = r.breaches.filter((b) => b.kind === 'scheme_switch');
      expect(sw).toHaveLength(1);
      expect(sw[0]?.schemeId).toBe('bfm-solo');
      expect(sw[0]?.windowEnd).toBe(at(1, '07:00'));
    });

    it('13b. control: with a 48 h reset rest break the switch is allowed and BFM counts from the end of the reset', () => {
      const reset = schedule('22:00', [['r', '22:00'], ['r', '22:00'], ['w', '02:00']]);
      const events = concat(lead, longDay, reset);
      const r = evaluate(events, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: at(1, '12:00'), scheme: BFM_SOLO }] }));
      expect(r.breaches.filter((b) => b.kind === 'scheme_switch')).toEqual([]);
      expect(r.status.kind !== 'invalid_input' && r.status.kind !== 'unsupported_jurisdiction' && r.status.notices.some((n) => n.code === 'reset_rest_taken')).toBe(true);
    });

    it('13c. control: switching while fully BFM-compliant is allowed without a reset', () => {
      const day13 = schedule('06:00', [['w', '11:00'], ['r', '11:30'], ['w', '16:30'], ['r', '17:00'], ['w', '20:00']]); // 13 h: Standard breach, BFM-compliant
      const events = concat(lead, day13, schedule('20:00', [['r', '08:00'], ['w', '12:00']]));
      const r = evaluate(events, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: at(1, '07:00'), scheme: BFM_SOLO }] }));
      expect(r.breaches.filter((b) => b.kind === 'scheme_switch')).toEqual([]);
      expect(byRule(r.breaches, 'std-solo-24h', 'max_work').length).toBeGreaterThan(0);
    });
  });

  describe('14. WA/NT guard', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '20:00']], { day: -1 });
    for (const tz of ['Australia/Perth', 'Australia/Darwin']) {
      it(`14. base tz ${tz} -> explicit "unsupported jurisdiction" result, not a pass`, () => {
        const r = evaluate(ev, ctx(STANDARD_SOLO, 'electronic', tz));
        expect(r.status.kind).toBe('unsupported_jurisdiction');
        expect(r.status.kind).not.toBe('compliant');
        expect(r.breaches).toEqual([]);
        const f = forecast(ev, ctx(STANDARD_SOLO, 'electronic', tz), at(0, '20:00'));
        expect(f.status).toBe('unsupported_jurisdiction');
        expect(f.earliest).toBeNull();
      });
    }
    it('14. a journey event in WA is also unsupported', () => {
      const wa = ev.map((e, i) => (i === 1 ? { ...e, jurisdiction: 'WA' as const } : e));
      expect(evaluate(wa, ctx(STANDARD_SOLO)).status.kind).toBe('unsupported_jurisdiction');
    });
  });
});
