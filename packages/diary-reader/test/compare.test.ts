import { BFM_SOLO, STANDARD_SOLO, type WorkRestEvent } from '@logm8/rules-engine';
import { describe, expect, it } from 'vitest';
import { cellLabel, compareSheet, logToCells, parseSheetDate, sheetToEvents } from '../src/compare.js';
import type { SheetReadingOk } from '../src/read.js';
import { SHEET_REQUIREMENTS } from '../src/requirements.js';
import { TEMPLATE_PRE_2026, TEMPLATE_V14 } from '../src/templates/index.js';
import type { CellState } from '../src/types.js';

const TZ = 'Australia/Brisbane';
const at = (date: string, hhmm: string): string => new Date(Date.parse(`${date}T${hhmm}:00+10:00`)).toISOString();

/** cells from a compact spec: [[state, fromHHMM, toHHMM], ...], default rest */
function cells(spec: Array<[CellState, string, string]>, base: CellState = 'rest'): CellState[] {
  const c: CellState[] = Array.from({ length: 96 }, () => base);
  const idx = (s: string): number => (Number(s.slice(0, 2)) * 60 + Number(s.slice(3))) / 15;
  for (const [st, a, b] of spec) for (let i = idx(a); i < idx(b); i++) c[i] = st;
  return c;
}

const ALL_FIELDS = Object.fromEntries([...TEMPLATE_V14.fields.map((f) => [f.id, true])]) as Record<string, boolean>;

function reading(cs: CellState[], over: Partial<SheetReadingOk> = {}): SheetReadingOk {
  const hours = new Set<number>();
  for (let i = 1; i < 96; i++) if (cs[i] !== cs[i - 1]) hours.add(Math.floor(i / 4));
  const ink = Array.from({ length: 24 }, (_, h) => hours.has(h));
  return {
    ok: true,
    version: 'v1.4',
    versionScores: {},
    template: TEMPLATE_V14,
    quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    cells: cs,
    workScores: [],
    restScores: [],
    checkboxes: { timeZone: { marked: ['QLD'], readable: true }, hoursOption: { marked: [], readable: true }, dayOfWeek: { marked: [], readable: false }, twoUpLicenceState: { marked: [], readable: true } },
    fieldInk: { ...ALL_FIELDS, totalWork: false, totalRest: false, twoUpName: false, twoUpLicenceNo: false, twoUpDiaryPage: false, twoUpSignature: false, dailyCheckTime: false },
    hourInk: { odometer: [...ink], place: [...ink] },
    fields: {},
    rectified: { width: 1, height: 1, data: new Float32Array(1) },
    ...over,
  };
}

const appLog = (date: string, spec: Array<['work' | 'rest', string, string]>): WorkRestEvent[] =>
  spec.map(([k, a, b]) => (k === 'work' ? { start: at(date, a), end: b === '24:00' ? at(nextDay(date), '00:00') : at(date, b), kind: 'work' } : { start: at(date, a), end: b === '24:00' ? at(nextDay(date), '00:00') : at(date, b), kind: 'rest', restLocation: 'stationary_out_of_vehicle' }));
const nextDay = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

describe('per-15-minute comparison with the app log', () => {
  const date = '2026-11-16';
  it('reports no differences when the sheet matches the log', () => {
    const cs = cells([['work', '06:00', '11:00'], ['work', '11:30', '15:00']]);
    const log = appLog(date, [['rest', '00:00', '06:00'], ['work', '06:00', '11:00'], ['rest', '11:00', '11:30'], ['work', '11:30', '15:00'], ['rest', '15:00', '24:00']]);
    const r = compareSheet({ reading: reading(cs), sheetDate: date, baseTimeZone: TZ, appEvents: log, scheme: STANDARD_SOLO });
    expect(r.cellDiffs).toEqual([]);
    expect(r.matchingCells).toBe(96);
  });

  it('lists each differing 15-minute block and merges them into ranges', () => {
    const cs = cells([['work', '06:00', '11:00'], ['work', '11:30', '15:00']]);
    const log = appLog(date, [['rest', '00:00', '06:00'], ['work', '06:00', '11:30'], ['work', '11:30', '15:45'], ['rest', '15:45', '24:00']]);
    const r = compareSheet({ reading: reading(cs), sheetDate: date, baseTimeZone: TZ, appEvents: log, scheme: STANDARD_SOLO });
    expect(r.cellDiffs.map((d) => d.time)).toEqual(['11:00', '11:15', '15:00', '15:15', '15:30']);
    expect(r.diffRanges).toEqual([
      { from: '11:00', to: '11:30', sheet: 'rest', app: 'work' },
      { from: '15:00', to: '15:45', sheet: 'rest', app: 'work' },
    ]);
  });

  it('uses the written-diary rule for the app log (work rounds out to 15-minute blocks)', () => {
    const log = appLog(date, [['rest', '00:00', '06:07'], ['work', '06:07', '10:02'], ['rest', '10:02', '24:00']]);
    const c = logToCells(log, date, TZ);
    expect(c[24]).toBe('work'); // 06:00 block
    expect(c[40]).toBe('work'); // 10:00 block
    expect(c[41]).toBe('rest');
    expect(logToCells([], date, TZ).every((x) => x === 'none')).toBe(true);
  });

  it('cells are in base time: a QLD-based driver photographing in NSW daylight saving still compares in Brisbane time', () => {
    const log: WorkRestEvent[] = [{ start: '2026-11-15T20:00:00.000Z', end: '2026-11-15T21:00:00.000Z', kind: 'work' }]; // 06:00-07:00 Brisbane
    const c = logToCells(log, date, TZ);
    expect(c.slice(24, 28)).toEqual(['work', 'work', 'work', 'work']);
    const syd = logToCells(log, date, 'Australia/Sydney'); // 07:00-08:00 Sydney
    expect(syd.slice(28, 32)).toEqual(['work', 'work', 'work', 'work']);
  });
});

describe('missing mandatory fields', () => {
  const cs = cells([['work', '06:00', '11:00'], ['work', '11:30', '15:00']]);
  const base = { baseTimeZone: TZ, appEvents: [], scheme: STANDARD_SOLO };

  it('a complete v1.4 sheet (Standard Hours) has nothing missing, and day/Standard tick/totals are NOT flagged after 1 Aug 2026', () => {
    const r = compareSheet({ ...base, reading: reading(cs), sheetDate: '2026-11-16' });
    expect(r.missing).toEqual([]);
    expect(r.rulesFromReform).toBe(true);
    expect(r.notRequired.sort()).toEqual(['dayOfWeek', 'hoursOption', 'totals']);
  });

  it('flags each always-required item when blank, with its source', () => {
    const r = compareSheet({ ...base, reading: reading(cs, { fieldInk: { ...ALL_FIELDS, driverName: false, licenceNo: false, numberPlate: false, date: false, signature: false }, checkboxes: { timeZone: { marked: [], readable: true }, hoursOption: { marked: [], readable: true } } }), sheetDate: '2026-11-16' });
    expect(r.missing.map((m) => m.id).sort()).toEqual(['date', 'driverName', 'licenceNo', 'numberPlate', 'signature', 'timeZone']);
    expect(r.missing.find((m) => m.id === 'timeZone')?.source).toBe('REG s15(1)(k)');
  });

  it('before 1 Aug 2026, day of week, hours option tick and totals are required', () => {
    const r = compareSheet({
      ...base,
      reading: reading(cs, { template: TEMPLATE_PRE_2026, version: 'pre-2026', checkboxes: { timeZone: { marked: ['QLD'], readable: true }, hoursOption: { marked: [], readable: true }, dayOfWeek: { marked: [], readable: true } } }),
      sheetDate: '2026-07-20',
    });
    expect(r.rulesFromReform).toBe(false);
    expect(r.missing.map((m) => m.id).sort()).toEqual(['dayOfWeek', 'hoursOption', 'totals']);
    expect(r.notRequired).toEqual([]);
  });

  it('an old (pre-2026) sheet used after 1 Aug 2026 follows the new rules', () => {
    const r = compareSheet({ ...base, reading: reading(cs, { template: TEMPLATE_PRE_2026, version: 'pre-2026', checkboxes: { timeZone: { marked: ['QLD'], readable: true }, hoursOption: { marked: [], readable: true }, dayOfWeek: { marked: [], readable: true } } }), sheetDate: '2026-09-01' });
    expect(r.missing).toEqual([]);
  });

  it('after 1 Aug 2026 a BFM driver must still tick the hours option', () => {
    const r = compareSheet({ ...base, scheme: BFM_SOLO, reading: reading(cs), sheetDate: '2026-11-16' });
    expect(r.missing.map((m) => m.id)).toEqual(['hoursOption']);
  });

  it('two-up drivers need the other driver’s name, licence number, licence state and signature', () => {
    const r = compareSheet({ ...base, twoUp: true, reading: reading(cs), sheetDate: '2026-11-16' });
    expect(r.missing.map((m) => m.id).sort()).toEqual(['twoUpLicenceNo', 'twoUpLicenceState', 'twoUpName', 'twoUpSignature']);
  });

  it('place and odometer are needed at each work/rest change; a same-day rest-to-work change is only a "check" (s16(6))', () => {
    const rd = reading(cs);
    rd.hourInk = { odometer: Array(24).fill(false), place: Array(24).fill(false) };
    const r = compareSheet({ ...base, reading: rd, sheetDate: '2026-11-16' });
    const ids = r.missing.map((m) => `${m.id}:${m.severity}`);
    expect(ids).toEqual(expect.arrayContaining(['place@06:00:missing', 'odometer@06:00:missing', 'place@11:00:missing', 'place@11:30:check', 'place@15:00:missing']));
    expect(r.missing.find((m) => m.id === 'place@11:30')?.note).toMatch(/s16\(6\)/);
    // the 06:00 start follows a rest that ran from midnight (began the day before): not exempt
    expect(r.missing.find((m) => m.id === 'place@06:00')?.severity).toBe('missing');
    expect(r.missing.find((m) => m.id === 'odometer@11:00')?.note).toMatch(/odometer is fitted/);
  });

  it('a change exactly on the hour may be written in the previous hour column', () => {
    const rd = reading(cs);
    rd.hourInk = { odometer: Array(24).fill(true), place: Array(24).fill(true) };
    rd.hourInk.place[6] = false; // change at 06:00 written in the 05:00 column
    expect(compareSheet({ ...base, reading: rd, sheetDate: '2026-11-16' }).missing).toEqual([]);
  });

  it('every requirement has a source', () => {
    for (const r of SHEET_REQUIREMENTS) expect(r.source).toMatch(/REG|NHVR/);
  });
});

describe('rule breaches visible on the sheet', () => {
  const base = { baseTimeZone: TZ, appEvents: [], sheetDate: '2026-11-16' };
  it('6 hours of work without a break breaches the 5 1/2 hour rule', () => {
    const r = compareSheet({ ...base, scheme: STANDARD_SOLO, reading: reading(cells([['work', '06:00', '12:00']])) });
    expect(r.breaches.some((b) => b.ruleId === 'std-solo-5.5h' && b.kind === 'max_work')).toBe(true);
    expect(r.ruleStatus).toBe('breach');
  });
  it('a compliant day has no breaches', () => {
    const r = compareSheet({ ...base, scheme: STANDARD_SOLO, reading: reading(cells([['work', '06:00', '11:00'], ['work', '11:30', '15:00']])) });
    expect(r.breaches).toEqual([]);
  });
  it('without a scheme, uses the hours option ticked on the sheet (BFM allows 6 h)', () => {
    const rd = reading(cells([['work', '06:00', '12:00']]), { checkboxes: { timeZone: { marked: ['QLD'], readable: true }, hoursOption: { marked: ['bfm'], readable: true } } });
    const r = compareSheet({ ...base, reading: rd });
    expect(r.schemeId).toBe('bfm-solo');
    expect(r.breaches.filter((b) => b.ruleId.startsWith('bfm-solo-6'))).toEqual([]);
    expect(compareSheet({ ...base, reading: reading(cells([])), twoUp: true }).schemeId).toBe('standard-two-up');
  });
});

describe('helpers', () => {
  it('parses handwritten dates', () => {
    expect(parseSheetDate('16/11/26')).toBe('2026-11-16');
    expect(parseSheetDate('6.8.2026')).toBe('2026-08-06');
    expect(parseSheetDate('31-02-26')).toBeNull();
    expect(parseSheetDate('yesterday')).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
  });
  it('converts the sheet grid to rules-engine events, skipping blank time', () => {
    const ev = sheetToEvents(cells([['work', '06:00', '08:00'], ['none', '20:00', '24:00']]), '2026-11-16', TZ);
    expect(ev.map((e) => [e.kind, e.start, e.end])).toEqual([
      ['rest', at('2026-11-16', '00:00'), at('2026-11-16', '06:00')],
      ['work', at('2026-11-16', '06:00'), at('2026-11-16', '08:00')],
      ['rest', at('2026-11-16', '08:00'), at('2026-11-16', '20:00')],
    ]);
    expect(cellLabel(95)).toBe('23:45');
  });
});
