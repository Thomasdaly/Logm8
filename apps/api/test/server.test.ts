import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FIELDS, StubVisionProvider, createApiServer, validateRequest, type VisionProvider } from '../src/server.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]).toString('base64');

describe('field-reading server (stub)', () => {
  const server = createApiServer();
  let base = '';
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    fetch(`${base}/v1/fields/read`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('reports health and the provider', async () => {
    const r = await fetch(`${base}/health`);
    expect(await r.json()).toEqual({ ok: true, provider: 'stub' });
  });

  it('accepts PNG field crops and returns a value per field (stub: not read)', async () => {
    const r = await post({ fields: [{ id: 'driverName', kind: 'text', imagePngBase64: PNG }, { id: 'place-06', kind: 'place', imagePngBase64: PNG }] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ provider: 'stub', fields: { driverName: { value: null, confidence: 0 }, 'place-06': { value: null, confidence: 0 } } });
  });

  it.each([
    ['invalid JSON', '{', 400],
    ['wrong shape', { nope: 1 }, 400],
    ['bad kind', { fields: [{ id: 'a', kind: 'photo', imagePngBase64: PNG }] }, 400],
    ['not a PNG', { fields: [{ id: 'a', kind: 'text', imagePngBase64: Buffer.from('GIF89a....').toString('base64') }] }, 400],
    ['bad id', { fields: [{ id: '../etc', kind: 'text', imagePngBase64: PNG }] }, 400],
  ])('rejects %s', async (_n, body, status) => {
    expect((await post(body)).status).toBe(status);
  });

  it('rejects wrong methods, paths and content types, and oversized bodies', async () => {
    expect((await fetch(`${base}/v1/fields/read`)).status).toBe(405);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await post({ fields: [] }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('x'.repeat(9 * 1024 * 1024))).status).toBe(413);
  });

  it('limits the number of fields and validates each one', () => {
    expect(validateRequest({ fields: Array.from({ length: MAX_FIELDS + 1 }, () => ({})) })).toMatchObject({ ok: false });
    expect(validateRequest({ fields: [null] })).toMatchObject({ ok: false });
    expect(validateRequest({ fields: [{ id: 'a', kind: 'text', imagePngBase64: '***' }] })).toMatchObject({ ok: false });
    expect(validateRequest({ fields: [] })).toEqual({ ok: true, fields: [] });
  });

  it('a failing provider yields "not read" rather than an error', async () => {
    const failing: VisionProvider = { name: 'fail', readField: async () => Promise.reject(new Error('down')) };
    const s = createApiServer(failing);
    await new Promise<void>((r) => s.listen(0, r));
    const r = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/v1/fields/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: [{ id: 'a', kind: 'text', imagePngBase64: PNG }] }) });
    expect(await r.json()).toEqual({ provider: 'fail', fields: { a: { value: null, confidence: 0 } } });
    await new Promise<void>((r2) => s.close(() => r2()));
    expect(await new StubVisionProvider().readField()).toEqual({ value: null, confidence: 0 });
  });
});
