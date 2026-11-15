import { BFM_SOLO, BFM_TWO_UP, STANDARD_SOLO, STANDARD_TWO_UP, evaluate, type Breach, type SchemeDefinition, type WorkRestEvent } from '@logm8/rules-engine';
import type { SheetReadingOk } from './read.js';
import { CHANGE_REQUIREMENTS, OPTIONAL_FROM_REFORM, REFORM_DATE, SHEET_REQUIREMENTS, type RecordingRequirement } from './requirements.js';
import type { CellState } from './types.js';

const MIN = 60_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function offsetMinutes(timeZone: string, ms: number): number {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    fmtCache.set(timeZone, f);
  }
  const p = f.formatToParts(new Date(ms));
  const g = (t: string): number => Number(p.find((x) => x.type === t)?.value);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(ms / MIN) * MIN) / MIN;
}

/** UTC ms of the start of 15-minute cell `i` on the sheet's date, in the base time zone. */
export function cellStartUtc(date: string, i: number, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y!, m! - 1, d, 0, i * 15);
  let guess = wall - offsetMinutes(timeZone, wall) * MIN;
  guess = wall - offsetMinutes(timeZone, guess) * MIN;
  return guess;
}

export function cellLabel(i: number): string {
  return `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
}

/** Parses a handwritten date such as 16/11/26, 16/11/2026, 16.11.26 or 16-11-26 to YYYY-MM-DD. */
export function parseSheetDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /^\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * The app's log on the sheet's 15-minute grid, using the written-diary rule: any work in a block makes it work;
 * a block is rest only if it is rest throughout; otherwise it is not recorded.
 */
export function logToCells(events: readonly WorkRestEvent[], date: string, timeZone: string): CellState[] {
  const ivs = events.map((e) => ({ s: Date.parse(e.start), e: Date.parse(e.end), kind: e.kind }));
  const cells: CellState[] = [];
  for (let i = 0; i < 96; i++) {
    const a = cellStartUtc(date, i, timeZone);
    const b = cellStartUtc(date, i + 1, timeZone);
    let work = 0;
    let rest = 0;
    for (const iv of ivs) {
      const o = Math.min(iv.e, b) - Math.max(iv.s, a);
      if (o <= 0) continue;
      if (iv.kind === 'work') work += o;
      else rest += o;
    }
    cells.push(work > 0 ? 'work' : rest >= b - a ? 'rest' : 'none');
  }
  return cells;
}

/**
 * The sheet's grid as work/rest events for the rules engine. The sheet does not say where rest was taken, so rest
 * is treated as stationary rest (see docs/DECISIONS.md, stage 3).
 */
export function sheetToEvents(cells: readonly CellState[], date: string, timeZone: string): WorkRestEvent[] {
  const out: WorkRestEvent[] = [];
  let i = 0;
  while (i < cells.length) {
    const s = cells[i];
    let j = i;
    while (j < cells.length && cells[j] === s) j++;
    if (s !== 'none') {
      const e: WorkRestEvent = { start: new Date(cellStartUtc(date, i, timeZone)).toISOString(), end: new Date(cellStartUtc(date, j, timeZone)).toISOString(), kind: s! };
      if (s === 'rest') e.restLocation = 'stationary_out_of_vehicle';
      out.push(e);
    }
    i = j;
  }
  return out;
}

export interface CellDiff {
  cell: number;
  time: string;
  sheet: CellState;
  app: CellState;
}

export interface DiffRange {
  from: string;
  to: string;
  sheet: CellState;
  app: CellState;
}

export interface MissingItem {
  id: string;
  label: string;
  source: string;
  /** 'missing' = required and absent; 'check' = may be exempt, the driver should check. */
  severity: 'missing' | 'check';
  note?: string;
}

export interface CompareInput {
  reading: SheetReadingOk;
  /** YYYY-MM-DD the sheet is for (from the handwritten date, or chosen by the driver). */
  sheetDate: string;
  baseTimeZone: string;
  /** The app's log (contiguous work/rest intervals). */
  appEvents: readonly WorkRestEvent[];
  /** The driver's scheme; if omitted it is inferred from the hours option ticked on the sheet. */
  scheme?: SchemeDefinition;
  twoUp?: boolean;
}

export interface CompareResult {
  sheetDate: string;
  rulesFromReform: boolean;
  sheetCells: CellState[];
  appCells: CellState[];
  cellDiffs: CellDiff[];
  diffRanges: DiffRange[];
  matchingCells: number;
  missing: MissingItem[];
  /** Items not flagged because they are optional on this sheet's date. */
  notRequired: string[];
  breaches: Breach[];
  schemeId: string;
  ruleStatus: string;
}

function schemeFromSheet(reading: SheetReadingOk, twoUp: boolean): SchemeDefinition {
  const ticked = reading.checkboxes.hoursOption?.marked ?? [];
  if (ticked.includes('bfm')) return twoUp ? BFM_TWO_UP : BFM_SOLO;
  return twoUp ? STANDARD_TWO_UP : STANDARD_SOLO;
}

function requirementApplies(r: RecordingRequirement, fromReform: boolean, standard: boolean, twoUp: boolean): boolean {
  switch (r.when) {
    case 'always':
      return true;
    case 'before_reform':
      return !fromReform;
    case 'non_standard_from_reform':
      return !fromReform || !standard;
    case 'two_up':
      return twoUp;
  }
}

function present(r: RecordingRequirement, reading: SheetReadingOk): boolean | null {
  const t = r.target;
  if ('field' in t) return reading.fieldInk[t.field] ?? false;
  if ('allFields' in t) return t.allFields.every((f) => reading.fieldInk[f] ?? false);
  const grp = reading.checkboxes[t.checkboxGroup];
  if (!grp || !grp.readable) return null; // cannot tell from this sheet version
  return grp.marked.length > 0;
}

/**
 * Compares a read daily sheet with the app's log: per-15-minute differences, missing mandatory items (taking
 * the 1 August 2026 changes into account), and rule breaches visible on the sheet itself.
 */
export function compareSheet(input: CompareInput): CompareResult {
  const { reading, sheetDate, baseTimeZone } = input;
  const fromReform = sheetDate >= REFORM_DATE;
  const twoUp = input.twoUp ?? (reading.fieldInk.twoUpName || reading.fieldInk.twoUpLicenceNo || false);
  const scheme = input.scheme ?? schemeFromSheet(reading, twoUp);
  const standard = scheme.family === 'standard';

  const sheetCells = reading.cells;
  const appCells = logToCells(input.appEvents, sheetDate, baseTimeZone);
  const cellDiffs: CellDiff[] = [];
  sheetCells.forEach((s, i) => {
    const a = appCells[i];
    if (s !== a) cellDiffs.push({ cell: i, time: cellLabel(i), sheet: s, app: a! });
  });
  const diffRanges: DiffRange[] = [];
  for (const d of cellDiffs) {
    const last = diffRanges[diffRanges.length - 1];
    const prevCell = last ? cellDiffs[cellDiffs.indexOf(d) - 1] : undefined;
    if (last && prevCell && prevCell.cell === d.cell - 1 && last.sheet === d.sheet && last.app === d.app) last.to = cellLabel(d.cell + 1);
    else diffRanges.push({ from: d.time, to: cellLabel(d.cell + 1), sheet: d.sheet, app: d.app });
  }

  const missing: MissingItem[] = [];
  const notRequired: string[] = [];
  for (const r of SHEET_REQUIREMENTS) {
    if (!requirementApplies(r, fromReform, standard, twoUp)) {
      if (fromReform && (r.when === 'before_reform' || r.when === 'non_standard_from_reform')) notRequired.push(r.id);
      continue;
    }
    const p = present(r, reading);
    if (p === false) missing.push({ id: r.id, label: r.label, source: r.source, severity: 'missing' });
  }

  // Place and odometer at each work/rest change (in the hour column of the change, or the one before if it is on the hour).
  for (let i = 1; i < sheetCells.length; i++) {
    const a = sheetCells[i - 1];
    const b = sheetCells[i];
    if (a === b || b === 'none' || (a === 'none' && b === 'rest')) continue;
    const h = Math.floor(i / 4);
    const cols = i % 4 === 0 && h > 0 ? [h, h - 1] : [h];
    // s16(6) only exempts a rest-to-work change when the rest started and ended on the same day. A rest that runs
    // from midnight (cell 0) is treated as having started the previous day, so it is not exempt.
    let runStart = i - 1;
    while (runStart > 0 && sheetCells[runStart - 1] === a) runStart--;
    const restToWork = a === 'rest' && b === 'work' && runStart > 0;
    for (const kind of ['place', 'odometer'] as const) {
      const ink = cols.some((c) => reading.hourInk[kind][c]);
      if (ink) continue;
      const req = CHANGE_REQUIREMENTS[kind];
      const item: MissingItem = { id: `${kind}@${cellLabel(i)}`, label: `${req.label} at ${cellLabel(i)}`, source: req.source, severity: restToWork ? 'check' : 'missing' };
      if (restToWork) item.note = CHANGE_REQUIREMENTS.restToWorkExemption;
      if (kind === 'odometer') item.note = `${item.note ? `${item.note} ` : ''}Only required if an odometer is fitted.`;
      missing.push(item);
    }
  }

  const result = evaluate(sheetToEvents(sheetCells, sheetDate, baseTimeZone), { baseTimeZone, recordingMode: 'written', scheme });
  return {
    sheetDate,
    rulesFromReform: fromReform,
    sheetCells,
    appCells,
    cellDiffs,
    diffRanges,
    matchingCells: 96 - cellDiffs.length,
    missing,
    notRequired: fromReform ? notRequired : [],
    breaches: result.breaches,
    schemeId: scheme.id,
    ruleStatus: result.status.kind,
  };
}

export { OPTIONAL_FROM_REFORM };
