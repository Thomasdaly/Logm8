import { GENESIS_HASH, type Hasher, computeHash } from './hash';
import type { EventType, GeoFix, NewEvent, StoredEvent, VerifyResult } from './types';

/** Minimal async SQL port (implemented by expo-sqlite in the app, node:sqlite in tests). */
export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params: ReadonlyArray<string | number | null>): Promise<void>;
  all<T>(sql: string, params: ReadonlyArray<string | number | null>): Promise<T[]>;
}

export const EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  device_time TEXT NOT NULL,
  network_time TEXT,
  lat REAL,
  lon REAL,
  accuracy_m REAL,
  fix_time TEXT,
  app_version TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only: UPDATE is not allowed'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only: DELETE is not allowed'); END;
`;

interface Row {
  seq: number;
  type: string;
  payload: string;
  device_time: string;
  network_time: string | null;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  fix_time: string | null;
  app_version: string;
  prev_hash: string;
  hash: string;
}

function rowToEvent(r: Row): StoredEvent {
  const position: GeoFix | null = r.lat === null || r.lon === null ? null : { lat: r.lat, lon: r.lon, accuracyM: r.accuracy_m, fixTime: r.fix_time };
  return {
    seq: r.seq,
    type: r.type as EventType,
    payload: JSON.parse(r.payload),
    deviceTime: r.device_time,
    networkTime: r.network_time,
    position,
    appVersion: r.app_version,
    prevHash: r.prev_hash,
    hash: r.hash,
  } as StoredEvent;
}

export class EventStoreError extends Error {}

/**
 * Append-only, hash-chained event store (SPEC §6).
 *
 * - There is no update or delete method, and SQLite triggers also reject UPDATE and DELETE.
 * - Every record stores the hash of the previous record, so editing, removing or re-ordering a record
 *   breaks the chain at that point (see verify()).
 * - Corrections are new `correction` events that reference the original and carry a reason.
 *
 * Limitation: removing the most recent records leaves a valid, shorter chain. Detecting that needs the head
 * hash to be anchored elsewhere (cloud sync, stage 4).
 */
export class EventStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: SqlDb,
    private readonly hasher: Hasher,
  ) {}

  async init(): Promise<void> {
    await this.db.exec(EVENTS_SCHEMA);
  }

  /** Appends are serialised so the chain is always built on the true head. */
  append<T extends EventType>(event: NewEvent<T>): Promise<StoredEvent<T>> {
    const run = this.queue.then(() => this.appendNow(event));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async appendNow<T extends EventType>(event: NewEvent<T>): Promise<StoredEvent<T>> {
    await this.validate(event);
    const head = (await this.db.all<{ seq: number; hash: string }>('SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1', []))[0];
    const seq = (head?.seq ?? 0) + 1;
    const prevHash = head?.hash ?? GENESIS_HASH;
    const hash = await computeHash(this.hasher, seq, prevHash, event);
    const p = event.position;
    await this.db.run(
      'INSERT INTO events (seq, type, payload, device_time, network_time, lat, lon, accuracy_m, fix_time, app_version, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [seq, event.type, JSON.stringify(event.payload), event.deviceTime, event.networkTime, p?.lat ?? null, p?.lon ?? null, p?.accuracyM ?? null, p?.fixTime ?? null, event.appVersion, prevHash, hash],
    );
    return { ...event, seq, prevHash, hash };
  }

  private async validate(event: NewEvent): Promise<void> {
    if (event.type !== 'correction') return;
    const c = event.payload as NewEvent<'correction'>['payload'];
    if (typeof c.reason !== 'string' || c.reason.trim().length === 0) throw new EventStoreError('A correction needs a reason.');
    if (!c.void && !c.replacement) throw new EventStoreError('A correction must either void the entry or give a replacement.');
    const target = (await this.db.all<Row>('SELECT * FROM events WHERE seq = ?', [c.targetSeq]))[0];
    if (!target) throw new EventStoreError(`Correction target #${c.targetSeq} does not exist.`);
    if (target.type !== 'state_change') throw new EventStoreError('Only state_change entries can be corrected.');
  }

  async list(): Promise<StoredEvent[]> {
    return (await this.db.all<Row>('SELECT * FROM events ORDER BY seq ASC', [])).map(rowToEvent);
  }

  /** Re-derives every hash and checks the chain. Returns the first record that does not verify. */
  async verify(): Promise<VerifyResult> {
    const rows = await this.db.all<Row>('SELECT * FROM events ORDER BY seq ASC', []);
    let prev = GENESIS_HASH;
    let expectedSeq = 1;
    for (const r of rows) {
      if (r.seq !== expectedSeq) return { ok: false, count: rows.length, brokenAtSeq: expectedSeq, reason: `record #${expectedSeq} is missing (found #${r.seq})` };
      if (r.prev_hash !== prev) return { ok: false, count: rows.length, brokenAtSeq: r.seq, reason: 'link to the previous record does not match (a record was removed, changed or re-ordered)' };
      let ev: StoredEvent;
      try {
        ev = rowToEvent(r);
      } catch {
        return { ok: false, count: rows.length, brokenAtSeq: r.seq, reason: 'record content is not readable' };
      }
      const expected = await computeHash(this.hasher, r.seq, r.prev_hash, ev);
      if (expected !== r.hash) return { ok: false, count: rows.length, brokenAtSeq: r.seq, reason: 'record content does not match its hash (the record was altered)' };
      prev = r.hash;
      expectedSeq++;
    }
    return { ok: true, count: rows.length, headHash: prev };
  }
}
