import { describe, expect, it } from 'vitest';
import { generateSheet } from '../src/synth/generate.js';
import { Rng } from '../src/synth/rng.js';
import { INVALID_KINDS, SCHEDULE_KINDS, changesOf, randomSchedule } from '../src/synth/schedule.js';

describe('synthetic fixture generator', () => {
  it('is deterministic per seed and alternates sheet versions', () => {
    const a = generateSheet(42);
    const b = generateSheet(42);
    expect(a.truth).toEqual(b.truth);
    expect(Buffer.from(a.jpeg).equals(Buffer.from(b.jpeg))).toBe(true);
    expect(generateSheet(2).truth.version).toBe('v1.4');
    expect(generateSheet(3).truth.version).toBe('pre-2026');
  });

  it('applies the SPEC §7 distortions: rotation within ±8°, blur, lighting gradient, JPEG quality', () => {
    const ps = Array.from({ length: 30 }, (_, i) => generateSheet(i + 1).truth.photo);
    for (const p of ps) {
      expect(Math.abs(p.rotationDeg)).toBeLessThanOrEqual(8);
      expect(p.jpegQuality).toBeGreaterThanOrEqual(55);
      expect(p.jpegQuality).toBeLessThanOrEqual(90);
      expect(p.lighting).toBeGreaterThan(0.09);
    }
    expect(new Set(ps.map((p) => p.blurRadius)).size).toBeGreaterThan(1);
    expect(Math.max(...ps.map((p) => Math.abs(p.rotationDeg)))).toBeGreaterThan(5);
    // perspective skew: opposite sides of the page quad are not parallel/equal
    const q = ps[0]!.quad;
    expect(Math.abs(Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) - Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y))).toBeGreaterThan(0.5);
  });

  it('produces both valid and invalid schedules, writes a JPEG and a complete ground truth', () => {
    const s = generateSheet(7);
    expect(s.jpeg[0]).toBe(0xff);
    expect(s.jpeg[1]).toBe(0xd8);
    expect(s.truth.cells).toHaveLength(96);
    expect(Object.keys(s.truth.fields)).toEqual(expect.arrayContaining(['date', 'driverName', 'licenceNo', 'numberPlate', 'signature']));
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => generateSheet(i + 1).truth.scheduleKind));
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    expect(INVALID_KINDS.some((k) => kinds.has(k))).toBe(true);
  });

  it('every schedule kind stays on the 96-cell grid', () => {
    const rng = new Rng(5);
    for (const k of SCHEDULE_KINDS) {
      const s = randomSchedule(rng, k);
      expect(s.cells).toHaveLength(96);
      expect(s.cells.every((c) => c === 'work' || c === 'rest' || c === 'none')).toBe(true);
    }
    expect(randomSchedule(rng, 'rest_day').cells.every((c) => c === 'rest')).toBe(true);
    expect(changesOf(['none', 'rest', 'work', 'work', 'rest', 'none'])).toEqual([
      { cell: 2, from: 'rest', to: 'work' },
      { cell: 4, from: 'work', to: 'rest' },
    ]);
  });

  it('Rng helpers stay in range', () => {
    const r = new Rng(0);
    for (let i = 0; i < 100; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
  });
});
