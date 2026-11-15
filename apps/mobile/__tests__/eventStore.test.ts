import { GENESIS_HASH, stableStringify } from '../src/lib/hash';
import { EventStore, EventStoreError } from '../src/lib/eventStore';
import { memoryStore, nodeSha256, memoryDb, profileEvent, stateEvent } from './helpers/testDb';

const T = (hhmm: string): string => `2026-11-16T${hhmm}:00.000Z`;

describe('append-only hash-chained event store (SPEC §6)', () => {
  it('chains each record to the hash of the previous one, starting from the genesis hash', async () => {
    const { store } = await memoryStore();
    const a = await store.append(profileEvent(T('01:00')));
    const b = await store.append(stateEvent(T('02:00'), 'work'));
    const c = await store.append(stateEvent(T('03:00'), 'rest'));
    expect(a.seq).toBe(1);
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(new Set([a.hash, b.hash, c.hash]).size).toBe(3);
    const verified = await store.verify();
    expect(verified).toEqual({ ok: true, count: 3, headHash: c.hash });
  });

  it('stores device time, trusted time, GPS position + accuracy and app version on each record', async () => {
    const { store } = await memoryStore();
    await store.append({ ...stateEvent(T('02:00'), 'work'), networkTime: T('02:00'), appVersion: '1.2.3' });
    const [e] = await store.list();
    expect(e).toMatchObject({
      deviceTime: T('02:00'),
      networkTime: T('02:00'),
      position: { lat: -27.47, lon: 153.02, accuracyM: 8, fixTime: T('02:00') },
      appVersion: '1.2.3',
    });
  });

  it('persists a missing position as null', async () => {
    const { store } = await memoryStore();
    await store.append(profileEvent(T('01:00')));
    expect((await store.list())[0]?.position).toBeNull();
  });

  it('serialises concurrent appends into one unbroken chain', async () => {
    const { store } = await memoryStore();
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.append(stateEvent(T(`0${i % 10}:00`), i % 2 ? 'work' : 'rest'))));
    const list = await store.list();
    expect(list.map((e) => e.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect((await store.verify()).ok).toBe(true);
  });

  it('the store has no update or delete API', () => {
    const methods = Object.getOwnPropertyNames(EventStore.prototype);
    expect(methods.filter((m) => /update|delete|remove|set|edit|clear|truncate/i.test(m))).toEqual([]);
  });

  describe('append-only is enforced in SQLite itself', () => {
    it('rejects UPDATE', async () => {
      const { store, raw } = await memoryStore();
      await store.append(stateEvent(T('02:00'), 'work'));
      expect(() => raw.exec("UPDATE events SET type = 'profile' WHERE seq = 1")).toThrow(/append-only/);
    });
    it('rejects DELETE', async () => {
      const { store, raw } = await memoryStore();
      await store.append(stateEvent(T('02:00'), 'work'));
      expect(() => raw.exec('DELETE FROM events WHERE seq = 1')).toThrow(/append-only/);
    });
  });

  describe('corrections are new events with a reason; nothing is rewritten', () => {
    it('records a correction that references the original, leaving the original byte-for-byte unchanged', async () => {
      const { store } = await memoryStore();
      const orig = await store.append(stateEvent(T('02:00'), 'work'));
      const before = JSON.stringify((await store.list())[0]);
      const corr = await store.append({
        type: 'correction',
        payload: { targetSeq: orig.seq, reason: 'Forgot to tap; started 15 minutes earlier', replacement: { state: 'work', at: T('01:45') } },
        deviceTime: T('02:10'),
        networkTime: null,
        position: null,
        appVersion: 'test',
      });
      const list = await store.list();
      expect(list).toHaveLength(2);
      expect(JSON.stringify(list[0])).toBe(before);
      expect(corr.seq).toBe(2);
      expect(corr.prevHash).toBe(orig.hash);
      expect((await store.verify()).ok).toBe(true);
    });

    it.each([
      ['an empty reason', { targetSeq: 1, reason: '   ', void: true }, /needs a reason/],
      ['neither void nor replacement', { targetSeq: 1, reason: 'oops' }, /either void/],
      ['a missing target', { targetSeq: 99, reason: 'oops', void: true }, /does not exist/],
    ])('rejects a correction with %s', async (_n, payload, re) => {
      const { store } = await memoryStore();
      await store.append(stateEvent(T('02:00'), 'work'));
      await expect(store.append({ type: 'correction', payload, deviceTime: T('03:00'), networkTime: null, position: null, appVersion: 't' })).rejects.toThrow(re);
      expect(await store.list()).toHaveLength(1);
    });

    it('only state_change entries can be corrected', async () => {
      const { store } = await memoryStore();
      await store.append(profileEvent(T('01:00')));
      await expect(
        store.append({ type: 'correction', payload: { targetSeq: 1, reason: 'x', void: true }, deviceTime: T('03:00'), networkTime: null, position: null, appVersion: 't' }),
      ).rejects.toThrow(EventStoreError);
    });
  });

  describe('a tampered record is detected', () => {
    /** Simulates an attacker with direct database access: they remove the guard triggers, then edit the file. */
    async function seeded() {
      const ctx = await memoryStore();
      for (let i = 0; i < 5; i++) await ctx.store.append(stateEvent(T(`0${i}:00`), i % 2 ? 'rest' : 'work'));
      ctx.raw.exec('DROP TRIGGER events_no_update; DROP TRIGGER events_no_delete;');
      return ctx;
    }

    it('detects an edited payload (work changed to rest)', async () => {
      const { store, raw } = await seeded();
      raw.exec(`UPDATE events SET payload = REPLACE(payload, '"state":"work"', '"state":"rest"') WHERE seq = 3`);
      const r = await store.verify();
      expect(r).toMatchObject({ ok: false, brokenAtSeq: 3 });
      expect(r.ok === false && r.reason).toMatch(/altered/);
    });

    it('detects an edited timestamp', async () => {
      const { store, raw } = await seeded();
      raw.exec("UPDATE events SET device_time = '2026-11-16T09:00:00.000Z' WHERE seq = 2");
      expect(await store.verify()).toMatchObject({ ok: false, brokenAtSeq: 2 });
    });

    it('detects an edited GPS position', async () => {
      const { store, raw } = await seeded();
      raw.exec('UPDATE events SET lat = -33.86 WHERE seq = 4');
      expect(await store.verify()).toMatchObject({ ok: false, brokenAtSeq: 4 });
    });

    it('detects an edited app version', async () => {
      const { store, raw } = await seeded();
      raw.exec("UPDATE events SET app_version = 'evil' WHERE seq = 1");
      expect(await store.verify()).toMatchObject({ ok: false, brokenAtSeq: 1 });
    });

    it('detects a record whose hash was recomputed by the attacker (the next link breaks)', async () => {
      const { store, raw, db } = await seeded();
      const row = (await db.all<{ payload: string }>('SELECT payload FROM events WHERE seq = 2', []))[0];
      const forged = row?.payload.replace('"rest"', '"work"') ?? '';
      const e = (await store.list())[1]!;
      const newHash = await nodeSha256(stableStringify([e.seq, e.prevHash, e.type, JSON.parse(forged), e.deviceTime, e.networkTime, e.position, e.appVersion]));
      raw.prepare('UPDATE events SET payload = ?, hash = ? WHERE seq = 2').run(forged, newHash);
      expect(await store.verify()).toMatchObject({ ok: false, brokenAtSeq: 3 });
    });

    it('detects a deleted record in the middle', async () => {
      const { store, raw } = await seeded();
      raw.exec('DELETE FROM events WHERE seq = 3');
      const r = await store.verify();
      expect(r).toMatchObject({ ok: false, brokenAtSeq: 3 });
      expect(r.ok === false && r.reason).toMatch(/missing/);
    });

    it('detects a deleted first record', async () => {
      const { store, raw } = await seeded();
      raw.exec('DELETE FROM events WHERE seq = 1');
      expect(await store.verify()).toMatchObject({ ok: false, brokenAtSeq: 1 });
    });

    it('detects re-ordered records', async () => {
      const { store, raw } = await seeded();
      raw.exec('UPDATE events SET seq = 99 WHERE seq = 2; UPDATE events SET seq = 2 WHERE seq = 3; UPDATE events SET seq = 3 WHERE seq = 99;');
      expect((await store.verify()).ok).toBe(false);
    });

    it('detects unreadable record content', async () => {
      const { store, raw } = await seeded();
      raw.exec("UPDATE events SET payload = 'not json' WHERE seq = 5");
      expect(await store.verify()).toMatchObject({ ok: false, brokenAtSeq: 5, reason: expect.stringMatching(/not readable/) });
    });

    it('an untouched chain still verifies (control)', async () => {
      const { store } = await seeded();
      expect(await store.verify()).toMatchObject({ ok: true, count: 5 });
    });
  });

  it('an empty store verifies', async () => {
    const { db } = memoryDb();
    const s = new EventStore(db, nodeSha256);
    await s.init();
    expect(await s.verify()).toEqual({ ok: true, count: 0, headHash: GENESIS_HASH });
  });

  it('stableStringify is key-order independent and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: null }] })).toBe(stableStringify({ a: [2, { c: null }], b: 1 }));
    expect(stableStringify(undefined)).toBe('null');
  });
});
