import type { NewEvent } from './types';

export const GENESIS_HASH = '0'.repeat(64);

/** Async SHA-256 hex digest. Injected so tests can use node:crypto and the app can use expo-crypto. */
export type Hasher = (input: string) => Promise<string>;

/** JSON with sorted object keys and no whitespace: the same value always yields the same string. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** The exact string that is hashed for a record: every stored field except the hash itself. */
export function hashInput(seq: number, prevHash: string, e: NewEvent): string {
  return stableStringify([seq, prevHash, e.type, e.payload, e.deviceTime, e.networkTime, e.position, e.appVersion]);
}

export async function computeHash(hasher: Hasher, seq: number, prevHash: string, e: NewEvent): Promise<string> {
  return hasher(hashInput(seq, prevHash, e));
}
