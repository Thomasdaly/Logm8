import { describe, expect, it } from 'vitest';
import {
  BFM_SOLO,
  BFM_TWO_UP,
  STANDARD_SOLO,
  STANDARD_TWO_UP,
  checkJurisdiction,
  countedTimeline,
  evaluate,
  forecast,
  longNightMinutes,
  nightRestBreakDates,
} from '../src/index.js';
import type { Breach, EvaluationResult, SchemeDefinition, WorkRestEvent } from '../src/index.js';
import { at, concat, ctx, schedule } from './helpers.js';

const notices = (r: EvaluationResult): string[] => (r.status.kind === 'compliant' || r.status.kind === 'breach' ? r.status.notices.map((n) => n.code) : []);
const find = (bs: Breach[], ruleId: string, requirementId?: string): Breach[] => bs.filter((b) => b.ruleId === ruleId && (requirementId === undefined || b.requirementId === requirementId));

/** Day shift 07:00-15:00 with a 30 min break: 7h30 work. */
function dayShift(day: number, restUntilHHMM = '07:00'): WorkRestEvent[] {
  return schedule('07:00', [['w', '12:15'], ['r', '12:45'], ['w', '15:00'], ['r', restUntilHHMM]], { day });
}

/** Three weeks of 6 day shifts + 40 h off. Compliant with Standard Hours solo. */
function compliantRoster(): WorkRestEvent[] {
  const ev: WorkRestEvent[] = schedule('22:00', [['r', '07:00']], { day: -1 });
  for (let week = 0; week < 3; week++) {
    for (let d = 0; d < 6; d++) {
      const day = week * 7 + d;
      const shift = dayShift(day);
      if (d === 5) {
        // 40 h off: 15:00 on day 5 to 07:00 on day 7
        const last = shift[shift.length - 1]!;
        shift[shift.length - 1] = { ...last, end: at(day + 2, '07:00') };
      }
      ev.push(...shift);
    }
  }
  return ev;
}

describe('Compliant schedules produce no breaches (no false positives)', () => {
  for (const mode of ['written', 'electronic'] as const) {
    it(`three weeks of 7h30 day shifts, 6 on / 40 h off, Standard solo (${mode})`, () => {
      const r = evaluate(compliantRoster(), ctx(STANDARD_SOLO, mode));
      expect(r.breaches).toEqual([]);
      expect(r.status.kind).toBe('compliant');
    });
  }
  it('the same roster is compliant under BFM solo', () => {
    expect(evaluate(compliantRoster(), ctx(BFM_SOLO)).breaches).toEqual([]);
  });
});

describe('Standard Hours rules', () => {
  it('14 days: 2 night rest breaks and 2 night rest breaks on consecutive days (non-concurrent)', () => {
    // Night shifts with daytime rest: only the weekly 40 h breaks contain night rest breaks.
    const ev: WorkRestEvent[] = schedule('08:00', [['r', '22:00']], { day: -1 });
    for (let week = 0; week < 3; week++) {
      for (let d = 0; d < 6; d++) {
        const day = week * 7 + d - 1;
        const shift = schedule('22:00', [['w', '03:15'], ['r', '03:45'], ['w', '06:00'], ['r', '22:00']], { day });
        if (d === 5) shift[shift.length - 1] = { ...shift[shift.length - 1]!, end: at(day + 2, '22:00') };
        ev.push(...shift);
      }
    }
    const r = evaluate(ev, ctx(STANDARD_SOLO));
    const consecutive = find(r.breaches, 'std-solo-14d', 'night-2-consecutive');
    expect(consecutive.length).toBeGreaterThan(0);
    expect(consecutive[0]?.unit).toBe('count');
    expect(consecutive[0]?.severity).toBeUndefined();
  });

  it('severity tiers follow Fatigue Reg Sch 1 (24 h work and 7 h rest)', () => {
    const work = (until: string): Breach | undefined =>
      find(evaluate(schedule('22:00', [['r', '06:00'], ['w', '11:00'], ['r', '11:15'], ['w', '16:00'], ['r', '16:15'], ['w', until], ['r', '10:00']], { day: -1 }), ctx(STANDARD_SOLO)).breaches, 'std-solo-24h').find(
        (b) => b.kind === 'max_work',
      );
    expect(work('18:30')).toBeUndefined(); // 12h work: at the limit
    expect(work('19:00')?.severity).toBe('minor'); // 12h30 work
    expect(work('19:30')?.severity).toBe('substantial'); // 13h
    expect(work('20:00')?.severity).toBe('severe'); // 13h30
    expect(work('20:30')?.severity).toBe('critical'); // 14h

    const ev = schedule('22:00', [['r', '06:00'], ['w', '11:00'], ['r', '17:00'], ['w', '22:00'], ['r', '00:00'], ['w', '05:00'], ['r', '08:00']], { day: -1 });
    const rest = find(evaluate(ev, ctx(STANDARD_SOLO)).breaches, 'std-solo-24h', 'rest-7h-stationary').find((b) => b.windowStart === at(0, '06:00'));
    expect(rest?.actual).toBe(6 * 60);
    expect(rest?.severity).toBe('substantial');
  });

  it('7 days: no 24 h rest in the period is a breach; a later 24 h rest that ends outside the period does not help', () => {
    const ev: WorkRestEvent[] = schedule('22:00', [['r', '07:00']], { day: -1 });
    for (let d = 0; d < 8; d++) ev.push(...dayShift(d));
    const r = evaluate(ev, ctx(STANDARD_SOLO));
    expect(find(r.breaches, 'std-solo-7d', 'rest-24h-stationary').length).toBeGreaterThan(0);
  });

  it('two-up 7 days: 24 h continuous and another 24 h in blocks of >= 7 h cannot be the same rest', () => {
    // One 39 h stationary rest and otherwise sleeper-berth (moving) rest only.
    const SM = 'sleeper_berth_moving' as const;
    const ev: WorkRestEvent[] = schedule('20:00', [['r', '06:00', SM]], { day: -1 });
    for (const d of [0, 1, 2, 4, 5, 6, 7, 8]) {
      const s = schedule('06:00', [['w', '11:00'], ['r', '11:30', SM], ['w', '15:00'], ['r', '06:00', SM]], { day: d });
      if (d === 2) s[s.length - 1] = { ...s[s.length - 1]!, restLocation: 'stationary_out_of_vehicle', end: at(4, '06:00') };
      ev.push(...s);
    }
    const r = evaluate(ev, ctx(STANDARD_TWO_UP));
    const blocks = find(r.breaches, 'std-two-7d', 'rest-24h-in-7h-blocks');
    expect(blocks.length).toBeGreaterThan(0);
    expect(find(r.breaches, 'std-two-7d', 'rest-24h-stationary')).toEqual([]);
  });

  describe('one long rest can serve two rest requirements, but its minutes are only counted once (Fatigue Reg s22(3), Sch 3)', () => {
    /** w 2 h, one long stationary rest of `restHours`, then 4 h work + 10 h non-stationary rest cycles for > 7 days. */
    const week = (restHours: number): WorkRestEvent[] => {
      const parts: Array<['work' | 'rest', number, ('stationary_out_of_vehicle' | 'in_vehicle_other')?]> = [['work', 120], ['rest', restHours * 60, 'stationary_out_of_vehicle']];
      for (let i = 0; i < 10; i++) parts.push(['work', 240], ['rest', 600, 'in_vehicle_other']);
      let t = Date.UTC(2026, 10, 15, 20, 0);
      return parts.map(([kind, mins, loc]) => {
        const start = new Date(t).toISOString();
        t += mins * 60_000;
        const e: WorkRestEvent = { start, end: new Date(t).toISOString(), kind };
        if (kind === 'rest' && loc) e.restLocation = loc;
        return e;
      });
    };
    const two = (hours: number) => evaluate(week(hours), ctx(STANDARD_TWO_UP));
    const sevenDayRest = (r: EvaluationResult): Breach[] => find(r.breaches, 'std-two-7d').filter((b) => b.kind === 'min_rest' && b.windowStart === at(0, '06:00'));

    it('a 48 h stationary rest satisfies both "24 h continuous" and "24 h in blocks of >= 7 h"', () => {
      expect(sevenDayRest(two(48))).toEqual([]);
    });
    it('a 60 h rest also satisfies both', () => {
      expect(sevenDayRest(two(60))).toEqual([]);
    });
    it('a 40 h rest satisfies the 24 h continuous requirement but not the second 24 h (only 16 h left)', () => {
      const b = sevenDayRest(two(40));
      expect(b.map((x) => x.requirementId)).toEqual(['rest-24h-in-7h-blocks']);
      expect(b[0]?.actual).toBe(16 * 60);
    });
    it('BFM two-up 7 days behaves the same way', () => {
      const ok = evaluate(week(48), ctx(BFM_TWO_UP));
      expect(find(ok.breaches, 'bfm-two-7d').filter((b) => b.kind === 'min_rest' && b.windowStart === at(0, '06:00'))).toEqual([]);
      const bad = evaluate(week(40), ctx(BFM_TWO_UP));
      expect(find(bad.breaches, 'bfm-two-7d', 'rest-24h-in-7h-blocks').some((b) => b.windowStart === at(0, '06:00'))).toBe(true);
    });
  });

  it('unfinished data: rest requirements are only checked once a period is complete', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '10:00']], { day: -1 });
    expect(evaluate(ev, ctx(STANDARD_SOLO)).breaches).toEqual([]);
  });
});

describe('BFM rules', () => {
  /** BFM day: 06:00-11:45, 30 min break, 12:15-18:00 = 11h30 work. */
  const bfmDay = (day: number): WorkRestEvent[] => schedule('06:00', [['w', '11:45'], ['r', '12:15'], ['w', '18:00'], ['r', '06:00']], { day });

  it('14 days: the 24 h rest must be taken after no more than 84 h work', () => {
    const ev: WorkRestEvent[] = schedule('22:00', [['r', '06:00']], { day: -1 });
    const days = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14];
    for (const d of days) {
      const s = bfmDay(d);
      if (d === 7 || d === 12) s[s.length - 1] = { ...s[s.length - 1]!, end: at(d + 2, '06:00') };
      ev.push(...s);
    }
    const r = evaluate(ev, ctx(BFM_SOLO));
    const b = find(r.breaches, 'bfm-solo-14d', 'rest-24h-after-84h').find((x) => x.windowStart === at(0, '06:00'));
    expect(b).toBeDefined();
    expect(find(r.breaches, 'bfm-solo-14d', 'rest-24h-stationary').find((x) => x.windowStart === at(0, '06:00'))).toBeUndefined();
  });

  it('@unverified split rest (HVNL s255 defence): 6 h + 2 h stationary rest is reported as a defence notice, not a breach, once', () => {
    const pattern = (day: number): WorkRestEvent[] =>
      schedule('06:00', [['w', '12:00'], ['r', '14:00'], ['w', '20:00'], ['r', '02:00'], ['w', '04:00'], ['r', '06:00']], { day });
    const ev = concat(schedule('22:00', [['r', '06:00']], { day: -1 }), pattern(0), pattern(1));
    ev[ev.length - 1] = { ...ev[ev.length - 1]!, end: at(2, '12:00') };
    const r = evaluate(ev, ctx(BFM_SOLO));
    expect(notices(r)).toContain('bfm_split_rest_defence');
    const rest = find(r.breaches, 'bfm-solo-24h', 'rest-7h-stationary');
    expect(rest.find((b) => b.windowStart === at(0, '06:00'))).toBeUndefined();
    // The next 24 h period relies on a split rest again, so the defence is not available.
    expect(rest.find((b) => b.windowStart === at(1, '02:00'))).toBeDefined();
  });

  it('two-up 82 hours: 10 continuous hours stationary rest', () => {
    const ev: WorkRestEvent[] = schedule('22:00', [['r', '06:00']], { day: -1 });
    for (let d = 0; d < 4; d++) ev.push(...schedule('06:00', [['w', '12:00'], ['r', '13:00'], ['w', '20:00'], ['r', '04:00'], ['r', '06:00', 'sleeper_berth_moving']], { day: d }));
    const r = evaluate(ev, ctx(BFM_TWO_UP));
    expect(find(r.breaches, 'bfm-two-82h', 'rest-10h-stationary').length).toBeGreaterThan(0);
  });

  it('long/night: work between 00:00 and 06:00 counts even when total work is short', () => {
    const ev = schedule('20:00', [['r', '04:00'], ['w', '07:00'], ['r', '20:00']], { day: -1 });
    expect(longNightMinutes(ev, ctx(BFM_SOLO), at(-1, '00:00'), at(3, '00:00'))).toEqual({ ok: true, value: 120 });
  });

  it('long/night is not defined for schemes without it', () => {
    const r = longNightMinutes([], ctx(STANDARD_SOLO), at(0, '00:00'), at(1, '00:00'));
    expect(r.ok).toBe(false);
    expect(longNightMinutes([], ctx(BFM_SOLO), 'bad', at(1, '00:00')).ok).toBe(false);
  });
});

describe('Scheme switching', () => {
  const ach: SchemeDefinition = { ...STANDARD_SOLO, id: 'custom-ach', name: 'Custom ACH', family: 'ach', switchingOut: 'reset_only' };
  const ev = concat(schedule('20:00', [['r', '06:00'], ['w', '11:00'], ['r', '20:00'], ['w', '22:00']], { day: -1 }));

  it('changing from ACH requires a reset rest break even when compliant', () => {
    const r = evaluate(ev, ctx(ach, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: at(0, '15:00'), scheme: STANDARD_SOLO }] }));
    expect(r.breaches.filter((b) => b.kind === 'scheme_switch')).toHaveLength(1);
  });

  it('scheme changes must be valid and chronological', () => {
    const bad = evaluate(ev, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: 'nope', scheme: BFM_SOLO }] }));
    expect(bad.status.kind).toBe('invalid_input');
    const order = evaluate(ev, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: at(0, '15:00'), scheme: BFM_SOLO }, { at: at(0, '14:00'), scheme: STANDARD_SOLO }] }));
    expect(order.status.kind).toBe('invalid_input');
  });

  it('a change after the end of the record is accepted', () => {
    const r = evaluate(ev, ctx(STANDARD_SOLO, 'electronic', 'Australia/Brisbane', { schemeChanges: [{ at: at(5, '00:00'), scheme: BFM_SOLO }] }));
    expect(r.status.kind).toBe('compliant');
    expect(r.status.kind === 'compliant' && r.status.schemeId).toBe('bfm-solo');
  });
});

describe('Input handling, notices and guards', () => {
  it('rejects malformed events with invalid_input (never a pass)', () => {
    const bad: WorkRestEvent[][] = [
      [{ start: '2026-11-16T06:00', end: '2026-11-16T07:00Z', kind: 'work' }],
      [{ start: '2026-11-16T06:00Z', end: 'later', kind: 'work' }],
      [{ start: '2026-11-16T07:00Z', end: '2026-11-16T06:00Z', kind: 'work' }],
      [{ start: '2026-11-16T06:00Z', end: '2026-11-16T07:00Z', kind: 'sleep' as 'work' }],
      [
        { start: '2026-11-16T06:00Z', end: '2026-11-16T08:00Z', kind: 'work' },
        { start: '2026-11-16T07:00Z', end: '2026-11-16T09:00Z', kind: 'work' },
      ],
    ];
    for (const ev of bad) expect(evaluate(ev, ctx(STANDARD_SOLO)).status.kind).toBe('invalid_input');
    expect(evaluate('nope' as unknown as WorkRestEvent[], ctx(STANDARD_SOLO)).status.kind).toBe('invalid_input');
  });

  it('rejects an invalid context', () => {
    expect(evaluate([], ctx(STANDARD_SOLO, 'electronic', 'Mars/Olympus')).status.kind).toBe('invalid_input');
    expect(evaluate([], ctx(STANDARD_SOLO, 'paper' as 'written')).status.kind).toBe('invalid_input');
    expect(evaluate([], null as never).status.kind).toBe('invalid_input');
  });

  it('a non-HVNL base time zone is an unsupported jurisdiction', () => {
    expect(evaluate([], ctx(STANDARD_SOLO, 'electronic', 'Europe/London')).status.kind).toBe('unsupported_jurisdiction');
    expect(checkJurisdiction('Australia/Sydney', [])).toEqual({ supported: true });
  });

  it('emits notices for unknown rest location, gaps in the record, and a record starting with work', () => {
    const ev: WorkRestEvent[] = [
      { start: at(0, '06:00'), end: at(0, '08:00'), kind: 'work' },
      { start: at(0, '08:00'), end: at(0, '09:00'), kind: 'rest' },
      { start: at(0, '10:00'), end: at(0, '11:00'), kind: 'work' },
      { start: at(0, '11:00'), end: at(0, '11:00'), kind: 'work' },
    ];
    const r = evaluate(ev, ctx(STANDARD_SOLO));
    expect(notices(r).sort()).toEqual(['data_gap', 'record_start_assumed_after_rest', 'rest_location_unknown']);
  });

  it('an empty record is compliant with no evaluated range', () => {
    const r = evaluate([], ctx(STANDARD_SOLO));
    expect(r.status).toMatchObject({ kind: 'compliant', evaluatedFrom: null, evaluatedTo: null });
  });

  it('analysis helpers report errors for unsupported or invalid input', () => {
    expect(countedTimeline([], ctx(STANDARD_SOLO, 'electronic', 'Australia/Perth')).ok).toBe(false);
    expect(nightRestBreakDates([], ctx(STANDARD_SOLO, 'electronic', 'Nowhere/None')).ok).toBe(false);
  });

  it('evaluate is deterministic and does not mutate its input', () => {
    const ev = Object.freeze(compliantRoster().map((e) => Object.freeze({ ...e })));
    const c = Object.freeze(ctx(BFM_SOLO));
    const a = evaluate(ev, c);
    const b = evaluate(ev, c);
    expect(a).toEqual(b);
  });

  it('accepts instants with explicit offsets', () => {
    const ev: WorkRestEvent[] = [{ start: '2026-11-16T06:00:00+10:00', end: '2026-11-16T12:00:00.000+10:00', kind: 'work' }];
    const r = evaluate(ev, ctx(STANDARD_SOLO));
    expect(find(r.breaches, 'std-solo-5.5h')[0]?.windowStart).toBe(at(0, '06:00'));
  });
});

describe('Forecast', () => {
  it('written mode: the current 15-minute block already counts as work (now 10:07 -> 68 min)', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '10:07']], { day: -1 });
    const f = forecast(ev, ctx(STANDARD_SOLO, 'written'), at(0, '10:07'));
    expect(f.minutesToEarliest).toBe(68);
    expect(f.minimumRestToClear).toBe(15);
  });

  it('a fresh start has no phantom "0 minutes" limits for two-up schemes (long rest serves both 24 h requirements)', () => {
    const f = forecast([], ctx(BFM_TWO_UP), at(0, '06:00'));
    expect(f.earliest?.ruleId).toBe('bfm-two-24h');
    expect(f.minutesToEarliest).toBe(14 * 60);
    expect(forecast([], ctx(STANDARD_TWO_UP), at(0, '06:00')).minutesToEarliest).toBe(5 * 60 + 15);
  });

  it('a fresh start (no record) allows 5 1/4 h of work under Standard solo', () => {
    const f = forecast([], ctx(STANDARD_SOLO), at(0, '06:00'));
    expect(f.minutesToEarliest).toBe(315);
  });

  it('a record that ends before now is assumed to continue until now', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '08:00']], { day: -1 });
    expect(forecast(ev, ctx(STANDARD_SOLO), at(0, '10:00')).minutesToEarliest).toBe(75);
  });

  it('events after now are ignored', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '10:00'], ['w', '18:00']], { day: -1 });
    expect(forecast(ev, ctx(STANDARD_SOLO), at(0, '10:00')).minutesToEarliest).toBe(75);
  });

  it('a driver already over a limit in a period that is still open has 0 minutes', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '16:30']], { day: -1 });
    const f = forecast(ev, ctx(STANDARD_SOLO), at(0, '16:30'));
    expect(f.minutesToEarliest).toBe(0);
    expect(f.limits.find((l) => l.ruleId === 'std-solo-11h' && l.kind === 'max_work')?.minutesUntilBreach).toBe(0);
  });

  it('after a closed 5 1/2 h period was breached, the next binding limit comes from the periods still open (HVNL s247)', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '12:00']], { day: -1 });
    const f = forecast(ev, ctx(STANDARD_SOLO), at(0, '12:00'));
    expect(f.earliest?.ruleId).toBe('std-solo-8h');
    expect(f.minutesToEarliest).toBe(90);
  });

  it('every limit is listed with its own countdown, sorted', () => {
    const ev = schedule('22:00', [['r', '06:00'], ['w', '10:00']], { day: -1 });
    const f = forecast(ev, ctx(STANDARD_SOLO), at(0, '10:00'));
    const ids = f.limits.map((l) => `${l.ruleId}:${l.kind}:${l.requirementId ?? ''}`);
    expect(ids).toContain('std-solo-24h:max_work:');
    expect(f.limits.find((l) => l.ruleId === 'std-solo-24h' && l.kind === 'max_work')?.minutesUntilBreach).toBe(8 * 60);
    const mins = f.limits.map((l) => l.minutesUntilBreach);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins);
  });

  it('invalid now / invalid input / unsupported jurisdiction', () => {
    expect(forecast([], ctx(STANDARD_SOLO), 'whenever').status).toBe('invalid_input');
    expect(forecast([], ctx(STANDARD_SOLO, 'electronic', 'Mars/Olympus'), at(0, '06:00')).errors?.length).toBeGreaterThan(0);
    expect(forecast([], ctx(STANDARD_SOLO, 'electronic', 'Australia/Darwin'), at(0, '06:00')).errors?.[0]).toMatch(/NT/);
  });

  it('a scheme whose limits cannot bind within their periods reports no earliest limit', () => {
    const lenient: SchemeDefinition = {
      ...STANDARD_SOLO,
      id: 'lenient',
      rules: [{ id: 'r', description: 'no effective limit', period: 1440, countFrom: 'any_rest', source: 't', maxWork: { minutes: 1440, measure: 'work' } }],
    };
    const f = forecast([], ctx(lenient), at(0, '06:00'));
    expect(f.status).toBe('ok');
    expect(f.earliest).toBeNull();
  });
});
