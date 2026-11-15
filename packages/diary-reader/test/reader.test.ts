import { describe, expect, it } from 'vitest';
import { evaluateReading, formatReport, summarise } from '../src/accuracy.js';
import { detectPage } from '../src/detect.js';
import { MockFieldReader } from '../src/fields.js';
import { decodeJpeg, makeGray, rgbaToGray } from '../src/image.js';
import { readSheet } from '../src/read.js';
import { generateSheet } from '../src/synth/generate.js';

describe('reading synthetic photographed sheets', () => {
  const N = 50;
  const sheets = Array.from({ length: N }, (_, i) => generateSheet(1000 + i));

  it(`reads the 15-minute grid on ${N} distorted synthetic sheets: >= 98% of cells and >= 90% of sheets fully correct`, async () => {
    const scores = [];
    for (const s of sheets) scores.push(evaluateReading(s.truth, await readSheet(s.jpeg)));
    const m = summarise(scores);
    console.log(formatReport(`test sample (${N} sheets)`, scores));
    expect(m.pagesFound).toBe(N);
    expect(m.cellAccuracy).toBeGreaterThanOrEqual(0.98);
    expect(m.fullyCorrectRate).toBeGreaterThanOrEqual(0.9);
  });

  it('detects the sheet version (pre-2026 vs v1.4)', async () => {
    for (const s of sheets.slice(0, 10)) {
      const r = await readSheet(s.jpeg);
      expect(r.ok && r.version).toBe(s.truth.version);
    }
  });

  it('finds the page corners to within a few pixels', () => {
    for (const s of sheets.slice(0, 10)) {
      const q = detectPage(rgbaToGray(decodeJpeg(s.jpeg)));
      expect(q).not.toBeNull();
      q?.forEach((p, i) => expect(Math.hypot(p.x - s.truth.photo.quad[i]!.x, p.y - s.truth.photo.quad[i]!.y)).toBeLessThan(4));
    }
  });

  it('reads checkboxes (time zone, hours option) and which fields have handwriting', async () => {
    let boxes = 0;
    let boxesOk = 0;
    let ink = 0;
    let inkOk = 0;
    for (const s of sheets.slice(0, 20)) {
      const sc = evaluateReading(s.truth, await readSheet(s.jpeg));
      boxes += sc.checkboxTotal;
      boxesOk += sc.checkboxCorrect;
      ink += sc.fieldInkTotal;
      inkOk += sc.fieldInkCorrect;
    }
    expect(boxesOk / boxes).toBeGreaterThan(0.98);
    expect(inkOk / ink).toBeGreaterThan(0.98);
  });

  it('passes inked text fields (not signatures) and the change-hour place/odometer columns to the FieldReader', async () => {
    const s = sheets[0];
    const reader = new MockFieldReader(s!.truth.fields);
    const r = await readSheet(s!.jpeg, { fieldReader: reader });
    expect(r.ok).toBe(true);
    const ids = reader.calls[0]!.map((c) => c.id);
    expect(ids).not.toContain('signature');
    for (const f of ['driverName', 'licenceNo', 'numberPlate']) if (s!.truth.fields[f]!) expect(ids).toContain(f);
    for (const h of s!.truth.hourInk.place) expect(ids).toContain(`place-${String(h).padStart(2, '0')}`);
    if (r.ok && s!.truth.fields.driverName) expect(r.fields.driverName).toEqual({ value: s!.truth.fields.driverName, confidence: 0.99 });
  });

  it('can be forced to a version', async () => {
    const s = sheets[1];
    const r = await readSheet(s!.jpeg, { version: s!.truth.version });
    expect(r.ok && Object.keys(r.versionScores)).toEqual([s!.truth.version]);
  });

  it('reports a clear error when no page is found or the photo cannot be decoded', async () => {
    const dark = makeGray(400, 300, 0.1);
    const r = await readSheet(dark);
    expect(r).toMatchObject({ ok: false, error: 'page_not_found' });
    const bad = await readSheet(new Uint8Array([1, 2, 3]));
    expect(bad).toMatchObject({ ok: false, error: 'decode_failed' });
    const rgba = { width: 2, height: 2, data: new Uint8Array(16) };
    expect((await readSheet(rgba)).ok).toBe(false);
  });
});
