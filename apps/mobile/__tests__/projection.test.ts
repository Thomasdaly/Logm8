import { profileHistory, projectEntries, toWorkRestEvents, trimHistory, currentEntry } from '../src/lib/projection';
import { buildTodaySlots } from '../src/lib/timeline';
import { buildContext, limitLabel, mergeForecasts, tierContexts } from '../src/lib/engine';
import { BASE_OPTIONS, schemeFor, validateProfileInput } from '../src/lib/profile';
import { localMidnight, formatLocalTime, formatLocalDateTime, offsetMinutes } from '../src/lib/tz';
import { forecast, STANDARD_SOLO, BFM_SOLO, STANDARD_TWO_UP } from '@logmate/rules-engine';
import type { StoredEvent } from '../src/lib/types';
import { PROFILE } from './helpers/testDb';

let seq = 0;
const sc = (at: string, state: 'work' | 'rest', extra = {}): StoredEvent => ({ seq: ++seq, type: 'state_change', payload: { state, at, source: 'manual', ...extra }, deviceTime: at, networkTime: null, position: null, appVersion: 't', prevHash: '', hash: '' }) as StoredEvent;
const corr = (targetSeq: number, payload: object): StoredEvent => ({ seq: ++seq, type: 'correction', payload: { targetSeq, reason: 'r', ...payload }, deviceTime: '2026-11-16T00:00:00.000Z', networkTime: null, position: null, appVersion: 't', prevHash: '', hash: '' }) as StoredEvent;
beforeEach(() => (seq = 0));

describe('projection', () => {
  it('orders entries by effective time and turns them into contiguous work/rest events up to now', () => {
    const entries = projectEntries([sc('2026-11-16T06:00:00.000Z', 'work'), sc('2026-11-16T08:00:00.000Z', 'rest', { restLocation: 'sleeper_berth_stationary' }), sc('2026-11-16T07:00:00.000Z', 'rest')]);
    expect(entries.map((e) => e.at)).toEqual(['2026-11-16T06:00:00.000Z', '2026-11-16T07:00:00.000Z', '2026-11-16T08:00:00.000Z']);
    expect(toWorkRestEvents(entries, '2026-11-16T09:00:00.000Z')).toEqual([
      { start: '2026-11-16T06:00:00.000Z', end: '2026-11-16T07:00:00.000Z', kind: 'work' },
      { start: '2026-11-16T07:00:00.000Z', end: '2026-11-16T08:00:00.000Z', kind: 'rest', restLocation: 'stationary_out_of_vehicle' },
      { start: '2026-11-16T08:00:00.000Z', end: '2026-11-16T09:00:00.000Z', kind: 'rest', restLocation: 'sleeper_berth_stationary' },
    ]);
  });

  it('applies the latest correction per entry; voided entries leave the projection but not the log', () => {
    const log = [sc('2026-11-16T06:00:00.000Z', 'work'), sc('2026-11-16T08:00:00.000Z', 'rest'), corr(2, { replacement: { state: 'rest', at: '2026-11-16T07:30:00.000Z' } }), corr(2, { replacement: { state: 'rest', at: '2026-11-16T07:45:00.000Z', restLocation: 'in_vehicle_other' } }), sc('2026-11-16T09:00:00.000Z', 'work'), corr(5, { void: true })];
    const e = projectEntries(log);
    expect(e).toHaveLength(2);
    expect(e[1]).toMatchObject({ at: '2026-11-16T07:45:00.000Z', restLocation: 'in_vehicle_other', correctedBySeq: 4 });
    expect(log).toHaveLength(6);
  });

  it('currentEntry ignores entries in the future and toWorkRestEvents ignores clock skew', () => {
    const e = projectEntries([sc('2026-11-16T06:00:00.000Z', 'work'), sc('2026-11-16T09:00:00.000Z', 'rest')]);
    expect(currentEntry(e, '2026-11-16T07:00:00.000Z')?.state).toBe('work');
    expect(currentEntry([], '2026-11-16T07:00:00.000Z')).toBeNull();
    expect(toWorkRestEvents(e, '2026-11-16T05:00:00.000Z')).toEqual([]);
  });

  it('profileHistory returns profile events in order', () => {
    const p = { seq: 1, type: 'profile', payload: { profile: PROFILE }, deviceTime: '2026-11-16T00:00:00.000Z', networkTime: null, position: null, appVersion: 't', prevHash: '', hash: '' } as StoredEvent;
    expect(profileHistory([p, sc('2026-11-16T06:00:00.000Z', 'work')])).toEqual([{ seq: 1, at: '2026-11-16T00:00:00.000Z', profile: PROFILE }]);
  });

  it('trimHistory drops old history and starts at a rest so the record never begins mid-work', () => {
    const ev = [
      { start: '2026-10-01T00:00:00.000Z', end: '2026-10-01T10:00:00.000Z', kind: 'work' as const },
      { start: '2026-10-01T10:00:00.000Z', end: '2026-11-10T00:00:00.000Z', kind: 'rest' as const },
      { start: '2026-11-10T00:00:00.000Z', end: '2026-11-10T10:00:00.000Z', kind: 'work' as const },
      { start: '2026-11-10T10:00:00.000Z', end: '2026-11-12T00:00:00.000Z', kind: 'rest' as const },
      { start: '2026-11-12T00:00:00.000Z', end: '2026-11-12T10:00:00.000Z', kind: 'work' as const },
    ];
    const t = trimHistory(ev, '2026-11-12T10:00:00.000Z', 3);
    expect(t[0]?.kind).toBe('rest');
    expect(t).toHaveLength(4);
    expect(trimHistory(ev, '2026-11-12T10:00:00.000Z', 90)).toHaveLength(5);
    expect(trimHistory([], '2026-11-12T10:00:00.000Z')).toEqual([]);
  });
});

describe('today timeline', () => {
  const tz = 'Australia/Brisbane';
  const now = Date.UTC(2026, 10, 15, 22, 7); // 08:07 Brisbane

  it('has 96 blocks aligned to base-time midnight, with the 15 minute written-diary rule', () => {
    const slots = buildTodaySlots(
      [
        { start: '2026-11-15T20:07:00.000Z', end: '2026-11-15T22:02:00.000Z', kind: 'work' }, // 06:07-08:02
        { start: '2026-11-15T22:02:00.000Z', end: '2026-11-15T22:07:00.000Z', kind: 'rest', restLocation: 'stationary_out_of_vehicle' },
      ],
      tz,
      now,
    );
    expect(slots).toHaveLength(96);
    const at = (hhmm: string) => slots.find((s) => formatLocalTime(tz, s.start) === hhmm)!.state;
    expect(at('00:00')).toBe('none');
    expect(at('06:00')).toBe('work'); // work from 06:07 rounds the block up
    expect(at('07:45')).toBe('work');
    expect(at('08:00')).toBe('work'); // work until 08:02
    expect(at('08:15')).toBe('future');
  });

  it('a block that is rest only part of the time is not rest', () => {
    const slots = buildTodaySlots([{ start: '2026-11-15T20:00:00.000Z', end: '2026-11-15T20:10:00.000Z', kind: 'rest', restLocation: 'stationary_out_of_vehicle' }], tz, Date.UTC(2026, 10, 15, 21, 0));
    expect(slots.find((s) => formatLocalTime(tz, s.start) === '06:00')?.state).toBe('none');
  });

  it('a whole rest block is rest, and the current block is judged on what has happened so far', () => {
    const slots = buildTodaySlots([{ start: '2026-11-15T20:00:00.000Z', end: '2026-11-15T20:35:00.000Z', kind: 'rest', restLocation: 'stationary_out_of_vehicle' }], tz, Date.UTC(2026, 10, 15, 20, 35));
    const st = (h: string) => slots.find((s) => formatLocalTime(tz, s.start) === h)?.state;
    expect(st('06:00')).toBe('rest');
    expect(st('06:15')).toBe('rest');
    expect(st('06:30')).toBe('rest'); // current block, rest so far
  });

  it('handles a daylight-saving day (Sydney, 5 Oct 2025 spring forward has 23 hours = 92 blocks)', () => {
    const slots = buildTodaySlots([], 'Australia/Sydney', Date.UTC(2025, 9, 5, 5, 0));
    expect(slots).toHaveLength(92);
  });
});

describe('time zone helpers', () => {
  it('computes base-time midnight, offsets and labels', () => {
    const now = Date.UTC(2026, 10, 15, 22, 7);
    expect(localMidnight('Australia/Brisbane', now)).toBe(Date.UTC(2026, 10, 15, 14, 0));
    expect(localMidnight('Australia/Brisbane', now, 1)).toBe(Date.UTC(2026, 10, 16, 14, 0));
    expect(offsetMinutes('Australia/Sydney', now)).toBe(660);
    expect(formatLocalTime('Australia/Brisbane', now)).toBe('08:07');
    expect(formatLocalDateTime('Australia/Brisbane', now)).toBe('16/11 08:07');
  });
});

describe('profile + engine adapters', () => {
  it('maps the profile to the right built-in scheme', () => {
    expect(schemeFor('standard', false).id).toBe('standard-solo');
    expect(schemeFor('standard', true).id).toBe('standard-two-up');
    expect(schemeFor('bfm', false).id).toBe('bfm-solo');
    expect(schemeFor('bfm', true).id).toBe('bfm-two-up');
  });

  it('BASE_OPTIONS: only supported HVNL states; every zone is accepted by the engine', () => {
    expect(BASE_OPTIONS.map((o) => o.state)).toEqual(['QLD', 'NSW', 'VIC', 'SA', 'TAS', 'ACT']);
    for (const o of BASE_OPTIONS) {
      const r = forecast([], { baseTimeZone: o.timeZone, recordingMode: 'written', scheme: STANDARD_SOLO }, '2026-11-16T00:00:00.000Z');
      expect(r.status).toBe('ok');
    }
  });

  it('validateProfileInput normalises and rejects bad registrations', () => {
    const ok = validateProfileInput({ schemeFamily: 'standard', twoUp: false, baseName: ' X ', baseState: 'VIC', rego: 'ab-12', wwdNumber: ' 5 ' });
    expect(ok).toMatchObject({ ok: true, profile: { baseName: 'X', baseTimeZone: 'Australia/Melbourne', rego: 'AB-12', wwdNumber: '5' } });
    const bad = validateProfileInput({ schemeFamily: 'standard', twoUp: false, baseName: 'X', baseState: 'VIC', rego: 'ab!@#', wwdNumber: '5' });
    expect(bad).toMatchObject({ ok: false, errors: { rego: expect.stringMatching(/letters, numbers/) } });
  });

  it('buildContext turns a changed scheme into a scheme change at that time', () => {
    const v = (seq: number, at: string, p = PROFILE) => ({ seq, at, profile: p });
    expect(buildContext([])).toBeNull();
    const one = buildContext([v(1, '2026-11-01T00:00:00.000Z')])!;
    expect(one.scheme.id).toBe('standard-solo');
    expect(one.schemeChanges).toBeUndefined();
    const two = buildContext([v(1, '2026-11-01T00:00:00.000Z'), v(2, '2026-11-05T00:00:00.000Z', { ...PROFILE, rego: 'NEW1' }), v(3, '2026-11-10T00:00:00.000Z', { ...PROFILE, schemeFamily: 'bfm' })])!;
    expect(two.schemeChanges).toEqual([{ at: '2026-11-10T00:00:00.000Z', scheme: BFM_SOLO }]);
  });

  it('limitLabel names the limit from the scheme data', () => {
    const ctx = buildContext([{ seq: 1, at: '2026-11-01T00:00:00.000Z', profile: PROFILE }])!;
    expect(limitLabel(ctx, null)).toBe('');
    expect(limitLabel(ctx, { schemeId: 'standard-solo', ruleId: 'std-solo-5.5h', kind: 'max_work', period: 330, minutesUntilBreach: 1 })).toBe('In any 5 1/2 hours: max 5 1/4 h work');
    expect(limitLabel(ctx, { schemeId: 'standard-solo', ruleId: 'std-solo-7d', kind: 'min_rest', requirementId: 'rest-24h-stationary', period: 1, minutesUntilBreach: 1 })).toMatch(/^Rest: 24 continuous hours/);
    expect(limitLabel(ctx, { schemeId: 'x', ruleId: 'nope', kind: 'max_work', period: 1, minutesUntilBreach: 1 })).toBe('nope');
  });

  describe('two-tier forecast (fast short-period rules, slow 7/14 day rules)', () => {
    it('splits the scheme by rule period and keeps the BFM 24 h rule that long/night needs', () => {
      const std = tierContexts(buildContext([{ seq: 1, at: 'x', profile: PROFILE }])!);
      expect(std.fast.scheme.rules.map((r) => r.id)).toEqual(['std-solo-5.5h', 'std-solo-8h', 'std-solo-11h', 'std-solo-24h']);
      expect(std.slow?.scheme.rules.map((r) => r.id)).toEqual(['std-solo-7d', 'std-solo-14d']);
      const bfm = tierContexts(buildContext([{ seq: 1, at: 'x', profile: { ...PROFILE, schemeFamily: 'bfm' } }])!);
      expect(bfm.slow?.scheme.rules.map((r) => r.id)).toEqual(['bfm-solo-24h', 'bfm-solo-7d', 'bfm-solo-14d']);
      const two = tierContexts({ baseTimeZone: 'Australia/Brisbane', recordingMode: 'written', scheme: STANDARD_TWO_UP });
      expect(two.fast.scheme.rules.map((r) => r.id)).toContain('std-two-52h');
    });

    it('falls back to a single pass when a scheme has no long (or no short) rules', () => {
      const only24 = { ...STANDARD_SOLO, rules: STANDARD_SOLO.rules.filter((r) => r.period === 1440) };
      expect(tierContexts({ baseTimeZone: 'Australia/Brisbane', recordingMode: 'written', scheme: only24 }).slow).toBeNull();
      const onlyLong = { ...STANDARD_SOLO, rules: STANDARD_SOLO.rules.filter((r) => r.period > 5000) };
      const t = tierContexts({ baseTimeZone: 'Australia/Brisbane', recordingMode: 'written', scheme: onlyLong });
      expect(t.slow).toBeNull();
      expect(t.fast.scheme.rules).toHaveLength(2);
    });

    it('keeps tiers for every scheme in a scheme change', () => {
      const t = tierContexts({ baseTimeZone: 'Australia/Brisbane', recordingMode: 'written', scheme: STANDARD_SOLO, schemeChanges: [{ at: '2026-11-10T00:00:00.000Z', scheme: BFM_SOLO }] });
      expect(t.slow?.schemeChanges?.[0]?.scheme.id).toBe('bfm-solo');
    });

    it('mergeForecasts picks the earliest limit across both tiers', () => {
      const ctxFast = { baseTimeZone: 'Australia/Brisbane', recordingMode: 'written' as const, scheme: STANDARD_SOLO };
      const f = forecast([], ctxFast, '2026-11-15T20:00:00.000Z');
      const lim = (ruleId: string, m: number) => ({ schemeId: 's', ruleId, kind: 'max_work' as const, period: 1, minutesUntilBreach: m });
      const slow = { ...f, limits: [lim('slow', 10)], earliest: lim('slow', 10), minutesToEarliest: 10 };
      expect(mergeForecasts(f, slow).earliest?.ruleId).toBe('slow');
      expect(mergeForecasts(f, slow).limits[0]?.ruleId).toBe('slow');
      const later = { ...f, limits: [lim('slow', 99999)], earliest: lim('slow', 99999), minutesToEarliest: 99999 };
      expect(mergeForecasts(f, later).earliest?.ruleId).toBe(f.earliest?.ruleId);
      expect(mergeForecasts(f, null)).toBe(f);
      expect(mergeForecasts({ ...f, status: 'invalid_input' }, slow).status).toBe('invalid_input');
      expect(mergeForecasts(f, { ...f, limits: [], earliest: null, minutesToEarliest: null })).toMatchObject({ earliest: f.earliest });
      expect(mergeForecasts({ ...f, limits: [], earliest: null, minutesToEarliest: null }, { ...f, limits: [], earliest: null })).toMatchObject({ limits: [] });
    });
  });
});
