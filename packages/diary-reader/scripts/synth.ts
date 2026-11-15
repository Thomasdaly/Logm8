/**
 * Writes synthetic photographed daily sheets and their ground truth to fixtures/synthetic/.
 * Usage: pnpm synth [count=200] [startSeed=1]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSheet } from '../src/synth/generate.js';

const count = Number(process.argv[2] ?? 200);
const start = Number(process.argv[3] ?? 1);
const dir = join(import.meta.dirname, '..', 'fixtures', 'synthetic');
mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const versions: Record<string, number> = {};
for (let s = start; s < start + count; s++) {
  const sheet = generateSheet(s);
  writeFileSync(join(dir, `${sheet.truth.id}.jpg`), sheet.jpeg);
  writeFileSync(join(dir, `${sheet.truth.id}.json`), `${JSON.stringify(sheet.truth, null, 2)}\n`);
  versions[sheet.truth.version] = (versions[sheet.truth.version] ?? 0) + 1;
}
console.log(`Wrote ${count} sheets (${JSON.stringify(versions)}) with ground truth to ${dir} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
