import type { SheetReading } from './read.js';
import type { CellState, SheetVersionId } from './types.js';

export interface TruthLike {
  id: string;
  version: SheetVersionId;
  cells: CellState[];
  fields?: Record<string, string | null>;
  checkboxes?: Record<string, string[]>;
}

export interface ReadingScore {
  id: string;
  version: SheetVersionId;
  pageFound: boolean;
  versionCorrect: boolean;
  cellsCorrect: number;
  cellsTotal: number;
  fullyCorrect: boolean;
  checkboxCorrect: number;
  checkboxTotal: number;
  fieldInkCorrect: number;
  fieldInkTotal: number;
  wrongCells: number[];
}

/** Scores one reading against ground truth. */
export function evaluateReading(truth: TruthLike, reading: SheetReading): ReadingScore {
  const base = { id: truth.id, version: truth.version, cellsTotal: truth.cells.length };
  if (!reading.ok) {
    return { ...base, pageFound: false, versionCorrect: false, cellsCorrect: 0, fullyCorrect: false, checkboxCorrect: 0, checkboxTotal: 0, fieldInkCorrect: 0, fieldInkTotal: 0, wrongCells: truth.cells.map((_, i) => i) };
  }
  const wrongCells = truth.cells.map((c, i) => (reading.cells[i] === c ? -1 : i)).filter((i) => i >= 0);
  let checkboxCorrect = 0;
  let checkboxTotal = 0;
  for (const grp of reading.template.checkboxGroups) {
    if (!grp.outlined || !truth.checkboxes) continue;
    const want = truth.checkboxes[grp.id] ?? [];
    const got = reading.checkboxes[grp.id]?.marked ?? [];
    for (const o of grp.options) {
      checkboxTotal++;
      if (want.includes(o.value) === got.includes(o.value)) checkboxCorrect++;
    }
  }
  let fieldInkCorrect = 0;
  let fieldInkTotal = 0;
  if (truth.fields) {
    for (const [id, v] of Object.entries(truth.fields)) {
      fieldInkTotal++;
      if ((v !== null) === (reading.fieldInk[id] ?? false)) fieldInkCorrect++;
    }
  }
  return {
    ...base,
    pageFound: true,
    versionCorrect: reading.version === truth.version,
    cellsCorrect: truth.cells.length - wrongCells.length,
    fullyCorrect: wrongCells.length === 0,
    checkboxCorrect,
    checkboxTotal,
    fieldInkCorrect,
    fieldInkTotal,
    wrongCells,
  };
}

export interface AccuracySummary {
  sheets: number;
  pagesFound: number;
  versionAccuracy: number;
  cellAccuracy: number;
  fullyCorrectRate: number;
  checkboxAccuracy: number;
  fieldInkAccuracy: number;
}

export function summarise(scores: readonly ReadingScore[]): AccuracySummary {
  const sum = (f: (s: ReadingScore) => number): number => scores.reduce((a, s) => a + f(s), 0);
  const ratio = (a: number, b: number): number => (b === 0 ? 1 : a / b);
  return {
    sheets: scores.length,
    pagesFound: sum((s) => (s.pageFound ? 1 : 0)),
    versionAccuracy: ratio(sum((s) => (s.versionCorrect ? 1 : 0)), scores.length),
    cellAccuracy: ratio(sum((s) => s.cellsCorrect), sum((s) => s.cellsTotal)),
    fullyCorrectRate: ratio(sum((s) => (s.fullyCorrect ? 1 : 0)), scores.length),
    checkboxAccuracy: ratio(sum((s) => s.checkboxCorrect), sum((s) => s.checkboxTotal)),
    fieldInkAccuracy: ratio(sum((s) => s.fieldInkCorrect), sum((s) => s.fieldInkTotal)),
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

export function formatReport(title: string, scores: readonly ReadingScore[]): string {
  const lines = [`=== ${title} ===`];
  const groups: Array<[string, readonly ReadingScore[]]> = [
    ['all', scores],
    ...(['v1.4', 'pre-2026'] as const).map((v) => [v, scores.filter((s) => s.version === v)] as [string, ReadingScore[]]),
  ];
  lines.push('set        sheets  pages  version   cells     fully-correct  checkboxes  field-ink');
  for (const [name, ss] of groups) {
    if (ss.length === 0) continue;
    const m = summarise(ss);
    lines.push(
      `${name.padEnd(10)} ${String(m.sheets).padStart(6)}  ${String(m.pagesFound).padStart(5)}  ${pct(m.versionAccuracy).padStart(7)}  ${pct(m.cellAccuracy).padStart(7)}  ${pct(m.fullyCorrectRate).padStart(13)}  ${pct(m.checkboxAccuracy).padStart(10)}  ${pct(m.fieldInkAccuracy).padStart(9)}`,
    );
  }
  const worst = [...scores].filter((s) => !s.fullyCorrect).sort((a, b) => b.wrongCells.length - a.wrongCells.length).slice(0, 5);
  if (worst.length > 0) lines.push(`not fully correct (worst first): ${worst.map((s) => `${s.id} (${s.pageFound ? `${s.wrongCells.length} cells` : 'page not found'})`).join(', ')}`);
  const m = summarise(scores);
  lines.push(`TARGETS: cell accuracy >= 98%: ${m.cellAccuracy >= 0.98 ? 'PASS' : 'FAIL'}; fully-correct sheets >= 90%: ${m.fullyCorrectRate >= 0.9 ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}
