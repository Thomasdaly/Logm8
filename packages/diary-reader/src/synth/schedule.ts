import type { CellState } from '../types.js';
import type { Rng } from './rng.js';

export type ScheduleKind = 'valid_day' | 'long_day' | 'no_break' | 'night_shift' | 'partial_day' | 'rest_day' | 'split_shift';

export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['valid_day', 'long_day', 'no_break', 'night_shift', 'partial_day', 'rest_day', 'split_shift'];

/** Kinds that are deliberately non-compliant with Standard Hours solo. */
export const INVALID_KINDS: readonly ScheduleKind[] = ['long_day', 'no_break'];

function fillWork(cells: CellState[], rng: Rng, start: number, totalWork: number, maxBlock: number): void {
  let i = start;
  let done = 0;
  while (done < totalWork && i < 96) {
    const block = Math.min(rng.int(8, maxBlock), totalWork - done, 96 - i);
    for (let k = 0; k < block; k++) cells[i + k] = 'work';
    i += block;
    done += block;
    i += rng.int(1, 4); // break of 15-60 min
  }
}

/** A random day on the 15-minute grid (96 cells). */
export function randomSchedule(rng: Rng, kind: ScheduleKind = rng.pick(SCHEDULE_KINDS)): { kind: ScheduleKind; cells: CellState[] } {
  const cells: CellState[] = Array.from({ length: 96 }, () => 'rest');
  switch (kind) {
    case 'valid_day':
      fillWork(cells, rng, rng.int(16, 36), rng.int(28, 46), 21);
      break;
    case 'long_day':
      fillWork(cells, rng, rng.int(14, 24), rng.int(52, 60), 20);
      break;
    case 'no_break': {
      const s = rng.int(20, 40);
      const len = rng.int(24, 30);
      for (let k = 0; k < len; k++) cells[s + k] = 'work';
      break;
    }
    case 'night_shift':
      for (let k = 0; k < rng.int(12, 20); k++) cells[k] = 'work';
      cells[rng.int(4, 8)] = 'rest';
      for (let k = rng.int(78, 86); k < 96; k++) cells[k] = 'work';
      break;
    case 'partial_day': {
      const s = rng.int(20, 40);
      for (let k = 0; k < s - rng.int(0, 8); k++) cells[k] = 'none';
      fillWork(cells, rng, s, rng.int(24, 40), 20);
      if (rng.chance(0.6)) for (let k = rng.int(80, 90); k < 96; k++) cells[k] = 'none';
      break;
    }
    case 'rest_day':
      break;
    case 'split_shift':
      fillWork(cells, rng, rng.int(20, 26), rng.int(16, 20), 18);
      fillWork(cells, rng, rng.int(60, 66), rng.int(12, 18), 16);
      break;
  }
  return { kind, cells };
}

/** Work/rest changes (cell index where the new state starts), including the first start of work. */
export function changesOf(cells: readonly CellState[]): Array<{ cell: number; from: CellState; to: CellState }> {
  const out: Array<{ cell: number; from: CellState; to: CellState }> = [];
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    if (a !== b && b !== 'none' && !(a === 'none' && b === 'rest')) out.push({ cell: i, from: a!, to: b! });
  }
  return out;
}
