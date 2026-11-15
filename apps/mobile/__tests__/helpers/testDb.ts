import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { EventStore, type SqlDb } from '../../src/lib/eventStore';
import type { Hasher } from '../../src/lib/hash';
import type { NewEvent, Profile } from '../../src/lib/types';

export const nodeSha256: Hasher = async (input) => createHash('sha256').update(input).digest('hex');

/** In-memory SQLite (node:sqlite) behind the same SqlDb port the app uses with expo-sqlite. */
export function memoryDb(): { db: SqlDb; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const db: SqlDb = {
    exec: async (sql) => {
      raw.exec(sql);
    },
    run: async (sql, params) => {
      raw.prepare(sql).run(...params);
    },
    all: async <T,>(sql: string, params: ReadonlyArray<string | number | null>) => raw.prepare(sql).all(...params) as T[],
  };
  return { db, raw };
}

export async function memoryStore(): Promise<{ store: EventStore; raw: DatabaseSync; db: SqlDb }> {
  const { db, raw } = memoryDb();
  const store = new EventStore(db, nodeSha256);
  await store.init();
  return { store, raw, db };
}

export const PROFILE: Profile = {
  schemeFamily: 'standard',
  twoUp: false,
  baseName: 'Brisbane',
  baseState: 'QLD',
  baseTimeZone: 'Australia/Brisbane',
  rego: 'ABC123',
  wwdNumber: 'WWD-0001',
  recordingMode: 'written',
};

export function profileEvent(at: string, profile: Profile = PROFILE): NewEvent<'profile'> {
  return { type: 'profile', payload: { profile }, deviceTime: at, networkTime: null, position: null, appVersion: 'test' };
}

export function stateEvent(at: string, state: 'work' | 'rest', extra: Partial<NewEvent<'state_change'>['payload']> = {}): NewEvent<'state_change'> {
  return {
    type: 'state_change',
    payload: { state, at, source: 'manual', ...extra },
    deviceTime: at,
    networkTime: null,
    position: { lat: -27.47, lon: 153.02, accuracyM: 8, fixTime: at },
    appVersion: 'test',
  };
}
