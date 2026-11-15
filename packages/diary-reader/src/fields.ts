import { bytesToBase64, encodePngGray } from './encode.js';
import type { GrayImage } from './types.js';

export type FieldKind = 'text' | 'date' | 'place' | 'odometer';

export interface FieldCrop {
  id: string;
  kind: FieldKind;
  image: GrayImage;
}

export interface FieldValue {
  value: string | null;
  /** 0..1 */
  confidence: number;
}

/**
 * Reads handwritten fields (date, locations, odometer, rego, two-up partner) from image crops.
 * Pluggable: tests use MockFieldReader; the app uses HttpFieldReader, which calls the LogM8 server. The server
 * holds any vision-model credentials: API keys never ship in the mobile app.
 */
export interface FieldReader {
  readFields(crops: FieldCrop[]): Promise<Record<string, FieldValue>>;
}

/** Returns fixed values (e.g. a synthetic sheet's ground truth). Crops without a value are returned as null. */
export class MockFieldReader implements FieldReader {
  readonly calls: FieldCrop[][] = [];
  constructor(
    private readonly values: Record<string, string | null>,
    private readonly confidence = 0.99,
  ) {}
  async readFields(crops: FieldCrop[]): Promise<Record<string, FieldValue>> {
    this.calls.push(crops);
    const out: Record<string, FieldValue> = {};
    for (const c of crops) {
      const v = this.values[c.id];
      out[c.id] = v === undefined || v === null ? { value: null, confidence: 0 } : { value: v, confidence: this.confidence };
    }
    return out;
  }
}

/** Used when no reader is configured (offline): handwriting is not read, only ink presence. */
export class NullFieldReader implements FieldReader {
  async readFields(): Promise<Record<string, FieldValue>> {
    return {};
  }
}

export interface HttpFieldReaderOptions {
  /** e.g. https://api.example.com/v1/fields/read */
  endpoint: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ReadFieldsRequest {
  fields: Array<{ id: string; kind: FieldKind; imagePngBase64: string }>;
}
export interface ReadFieldsResponse {
  fields: Record<string, FieldValue>;
}

/** Sends crops (as greyscale PNG) to the LogM8 server, which runs the vision model. No credentials are sent. */
export class HttpFieldReader implements FieldReader {
  constructor(private readonly opts: HttpFieldReaderOptions) {}

  async readFields(crops: FieldCrop[]): Promise<Record<string, FieldValue>> {
    if (crops.length === 0) return {};
    const body: ReadFieldsRequest = { fields: crops.map((c) => ({ id: c.id, kind: c.kind, imagePngBase64: bytesToBase64(encodePngGray(c.image)) })) };
    const f = this.opts.fetchImpl ?? fetch;
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 20_000) : null;
    try {
      const res = await f(this.opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
      if (!res.ok) throw new Error(`field reader server returned ${res.status}`);
      const json = (await res.json()) as Partial<ReadFieldsResponse>;
      const out: Record<string, FieldValue> = {};
      for (const c of crops) {
        const v = json.fields?.[c.id];
        out[c.id] =
          v && (typeof v.value === 'string' || v.value === null) && typeof v.confidence === 'number'
            ? { value: v.value, confidence: Math.max(0, Math.min(1, v.confidence)) }
            : { value: null, confidence: 0 };
      }
      return out;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
