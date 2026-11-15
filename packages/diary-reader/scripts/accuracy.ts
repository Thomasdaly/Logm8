/**
 * Accuracy report: generates synthetic sheets (both versions), reads them back and compares with ground truth.
 * Real photos in fixtures/real/ (with <name>.json ground truth) are reported separately.
 * Usage: pnpm accuracy [count=240]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateReading, formatReport, type ReadingScore } from '../src/accuracy.js';
import { MockFieldReader } from '../src/fields.js';
import { readSheet } from '../src/read.js';
import { generateSheet } from '../src/synth/generate.js';
import type { CellState, SheetVersionId } from '../src/types.js';

const count = Number(process.argv[2] ?? 240);
const t0 = Date.now();
const scores: ReadingScore[] = [];
for (let seed = 1; seed <= count; seed++) {
  const s = generateSheet(seed);
  const reading = await readSheet(s.jpeg, { fieldReader: new MockFieldReader(s.truth.fields) });
  scores.push(evaluateReading(s.truth, reading));
}
console.log(formatReport(`Synthetic sheets (seeds 1-${count})`, scores));
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);

const realDir = join(import.meta.dirname, '..', 'fixtures', 'real');
const real = existsSync(realDir) ? readdirSync(realDir).filter((f) => /\.jpe?g$/i.test(f) && existsSync(join(realDir, f.replace(/\.jpe?g$/i, '.json')))) : [];
if (real.length === 0) {
  console.log('\nReal photos: none in fixtures/real/ (add <name>.jpg + <name>.json to measure real-world accuracy).');
} else {
  const realScores: ReadingScore[] = [];
  for (const f of real) {
    const truth = JSON.parse(readFileSync(join(realDir, f.replace(/\.jpe?g$/i, '.json')), 'utf8')) as { version: SheetVersionId; cells: CellState[] };
    const reading = await readSheet(new Uint8Array(readFileSync(join(realDir, f))));
    realScores.push(evaluateReading({ id: f, version: truth.version, cells: truth.cells }, reading));
  }
  console.log(`\n${formatReport('Real photos (fixtures/real)', realScores)}`);
}
