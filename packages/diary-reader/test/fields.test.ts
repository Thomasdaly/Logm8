import { inflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { base64ToBytes, bytesToBase64, encodePngGray } from '../src/encode.js';
import { HttpFieldReader, MockFieldReader, NullFieldReader, type FieldCrop } from '../src/fields.js';
import { applyHomography, solveHomography, warp } from '../src/homography.js';
import { boxBlur, crop, downscale, makeGray, otsu, quantileIn } from '../src/image.js';

const crop1: FieldCrop = { id: 'driverName', kind: 'text', image: makeGray(4, 2, 0.5) };

describe('FieldReader implementations', () => {
  it('MockFieldReader returns the configured values and null for unknown fields', async () => {
    const r = new MockFieldReader({ driverName: 'J SMITH', date: null });
    expect(await r.readFields([crop1, { ...crop1, id: 'date' }, { ...crop1, id: 'other' }])).toEqual({
      driverName: { value: 'J SMITH', confidence: 0.99 },
      date: { value: null, confidence: 0 },
      other: { value: null, confidence: 0 },
    });
    expect(r.calls).toHaveLength(1);
  });

  it('NullFieldReader reads nothing (offline)', async () => {
    expect(await new NullFieldReader().readFields()).toEqual({});
  });

  it('HttpFieldReader posts PNG crops to the server and validates the reply (no credentials are sent)', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.fields[0].id).toBe('driverName');
      expect(base64ToBytes(body.fields[0].imagePngBase64).slice(1, 4)).toEqual(new Uint8Array([80, 78, 71]));
      expect(JSON.stringify(init?.headers)).not.toMatch(/authorization|api[-_]?key/i);
      return new Response(JSON.stringify({ fields: { driverName: { value: 'J SMITH', confidence: 1.4 }, junk: 1 } }), { status: 200 });
    });
    const r = new HttpFieldReader({ endpoint: 'https://api.example.test/v1/fields/read', fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await r.readFields([crop1, { ...crop1, id: 'date', kind: 'date' }])).toEqual({ driverName: { value: 'J SMITH', confidence: 1 }, date: { value: null, confidence: 0 } });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.test/v1/fields/read', expect.objectContaining({ method: 'POST' }));
    expect(await r.readFields([])).toEqual({});
  });

  it('HttpFieldReader surfaces server errors', async () => {
    const r = new HttpFieldReader({ endpoint: 'https://x.test', fetchImpl: (async () => new Response('no', { status: 501 })) as unknown as typeof fetch });
    await expect(r.readFields([crop1])).rejects.toThrow(/501/);
  });
});

describe('encoders', () => {
  it('base64 round-trips and matches Node', () => {
    for (const n of [0, 1, 2, 3, 10, 257]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });

  it('encodes a valid greyscale PNG', () => {
    const img = makeGray(3, 2, 0);
    img.data.set([0, 0.5, 1, 1, 0.5, 0]);
    const png = encodePngGray(img);
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatLen = new DataView(png.buffer).getUint32(33);
    const raw = inflateSync(Buffer.from(png.slice(41, 41 + idatLen)));
    expect([...raw]).toEqual([0, 0, 128, 255, 0, 255, 128, 0]);
  });
});

describe('image geometry helpers', () => {
  it('homography maps the four points and warps an image', () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const dst = [{ x: 5, y: 5 }, { x: 25, y: 7 }, { x: 24, y: 30 }, { x: 3, y: 28 }];
    const h = solveHomography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(h, p.x, p.y);
      expect(q.x).toBeCloseTo(dst[i]!.x, 6);
      expect(q.y).toBeCloseTo(dst[i]!.y, 6);
    });
    expect(() => solveHomography(src.slice(0, 3), dst.slice(0, 3))).toThrow();
    expect(() => solveHomography([src[0]!, src[0]!, src[0]!, src[0]!], dst)).toThrow(/degenerate/);
    const img = makeGray(4, 4, 0.2);
    const out = warp(img, solveHomography(src, src), 4, 4);
    expect(out.data[5]).toBeCloseTo(0.2);
  });

  it('blur, downscale, crop, quantile and otsu behave', () => {
    const img = makeGray(8, 8, 1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) img.data[y * 8 + x] = 0;
    expect(otsu(img)).toBeGreaterThan(0);
    expect(otsu(img)).toBeLessThan(1);
    expect(downscale(img, 2).width).toBe(4);
    expect(downscale(img, 1)).toBe(img);
    expect(boxBlur(img, 0)).toBe(img);
    expect(boxBlur(img, 1).data[3]).toBeCloseTo(1 / 3);
    expect(crop(img, 2, 2, 3, 3).width).toBe(3);
    expect(quantileIn(img, 0, 0, 8, 8, 0.9)).toBe(1);
    expect(quantileIn(img, 20, 20, 30, 30, 0.5)).toBe(1);
  });
});
