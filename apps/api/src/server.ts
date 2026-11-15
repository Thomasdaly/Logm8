import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';

export type FieldKind = 'text' | 'date' | 'place' | 'odometer';

export interface FieldCropIn {
  id: string;
  kind: FieldKind;
  /** Greyscale PNG of the handwritten field, base64. */
  imagePngBase64: string;
}

export interface FieldValue {
  value: string | null;
  confidence: number;
}

/**
 * Reads handwriting from a field crop. A real implementation calls a vision model from the server, where its
 * credentials live (environment variables on the server only; never in the mobile app).
 */
export interface VisionProvider {
  readonly name: string;
  readField(crop: FieldCropIn): Promise<FieldValue>;
}

/** Stage 3 stub: accepts the request shape and returns "not read" for every field. */
export class StubVisionProvider implements VisionProvider {
  readonly name = 'stub';
  async readField(): Promise<FieldValue> {
    return { value: null, confidence: 0 };
  }
}

const KINDS: readonly FieldKind[] = ['text', 'date', 'place', 'odometer'];
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_FIELDS = 80;

export type ValidationResult = { ok: true; fields: FieldCropIn[] } | { ok: false; error: string };

export function validateRequest(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { fields?: unknown }).fields)) return { ok: false, error: 'body must be { fields: [...] }' };
  const fields = (body as { fields: unknown[] }).fields;
  if (fields.length > MAX_FIELDS) return { ok: false, error: `at most ${MAX_FIELDS} fields per request` };
  const out: FieldCropIn[] = [];
  for (const [i, f] of fields.entries()) {
    if (typeof f !== 'object' || f === null) return { ok: false, error: `fields[${i}] must be an object` };
    const { id, kind, imagePngBase64 } = f as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[A-Za-z0-9@:_-]{1,64}$/.test(id)) return { ok: false, error: `fields[${i}].id is invalid` };
    if (typeof kind !== 'string' || !KINDS.includes(kind as FieldKind)) return { ok: false, error: `fields[${i}].kind must be one of ${KINDS.join(', ')}` };
    if (typeof imagePngBase64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(imagePngBase64)) return { ok: false, error: `fields[${i}].imagePngBase64 must be base64` };
    if (!Buffer.from(imagePngBase64.slice(0, 12), 'base64').subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))) return { ok: false, error: `fields[${i}] is not a PNG image` };
    out.push({ id, kind: kind as FieldKind, imagePngBase64 });
  }
  return { ok: true, fields: out };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<Buffer | 'too_large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return 'too_large';
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createApiServer(provider: VisionProvider = new StubVisionProvider()): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/health') {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
        return send(res, 200, { ok: true, provider: provider.name });
      }
      if (url.pathname !== '/v1/fields/read') return send(res, 404, { error: 'not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'content-type must be application/json' });
      const raw = await readBody(req);
      if (raw === 'too_large') return send(res, 413, { error: 'request too large' });
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
      const v = validateRequest(body);
      if (!v.ok) return send(res, 400, { error: v.error });
      const fields: Record<string, FieldValue> = {};
      for (const f of v.fields) {
        try {
          fields[f.id] = await provider.readField(f);
        } catch {
          fields[f.id] = { value: null, confidence: 0 };
        }
      }
      return send(res, 200, { fields, provider: provider.name });
    })().catch(() => send(res, 500, { error: 'internal error' }));
  });
}
