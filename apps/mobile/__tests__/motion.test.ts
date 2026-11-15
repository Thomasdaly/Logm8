import { DEFAULT_MOTION_CONFIG, MotionSuggester, speedToKmh } from '../src/lib/motion';
import { MIN, makeHarness } from './helpers/fakes';

describe('speedToKmh', () => {
  it('converts m/s to km/h and treats null/negative/NaN as unknown', () => {
    expect(speedToKmh(10)).toBeCloseTo(36);
    expect(speedToKmh(0)).toBe(0);
    expect(speedToKmh(-1)).toBeNull();
    expect(speedToKmh(null)).toBeNull();
    expect(speedToKmh(undefined)).toBeNull();
    expect(speedToKmh(NaN)).toBeNull();
  });
});

describe('MotionSuggester (pure)', () => {
  const sample = (t: number, speedKmh: number | null) => ({ t, speedKmh, fix: null });

  it('suggests start_work only after movement is sustained, back-dated to when it began', () => {
    const m = new MotionSuggester();
    expect(m.update(sample(0, 50), 'rest')).toBeNull();
    expect(m.update(sample(20_000, 50), 'rest')).toBeNull();
    const s = m.update(sample(30_000, 50), 'rest');
    expect(s).toMatchObject({ kind: 'start_work', since: 0 });
  });

  it('does not suggest work when already working, and does not suggest for a brief movement', () => {
    const m = new MotionSuggester();
    expect(m.update(sample(0, 50), 'work')).toBeNull();
    expect(m.update(sample(60_000, 50), 'work')).toBeNull();
    const m2 = new MotionSuggester();
    m2.update(sample(0, 50), 'rest');
    m2.update(sample(10_000, 2), 'rest');
    expect(m2.update(sample(40_000, 50), 'rest')).toBeNull();
  });

  it('suggests start_rest after 15 minutes stopped while working, and withdraws it if the vehicle moves', () => {
    const m = new MotionSuggester();
    m.update(sample(0, 0), 'work');
    expect(m.update(sample(14 * MIN, 0), 'work')).toBeNull();
    const s = m.update(sample(15 * MIN, 0), 'work');
    expect(s).toMatchObject({ kind: 'start_rest', since: 0 });
    expect(m.update(sample(16 * MIN, 40), 'work')).toBeNull();
  });

  it('a slow crawl above the stopped threshold does not count as stopped', () => {
    const m = new MotionSuggester();
    m.update(sample(0, 0), 'work');
    m.update(sample(5 * MIN, 5), 'work');
    expect(m.update(sample(16 * MIN, 0), 'work')).toBeNull();
  });

  it('ignores unknown speeds and does not repeat a dismissed suggestion', () => {
    const m = new MotionSuggester();
    m.update(sample(0, 50), 'rest');
    m.update(sample(31_000, null), 'rest');
    expect(m.suggestion).not.toBeNull();
    m.dismiss();
    expect(m.suggestion).toBeNull();
    expect(m.update(sample(60_000, 50), 'rest')).toBeNull();
    // a new movement is a new suggestion
    m.update(sample(70_000, 0), 'rest');
    m.update(sample(80_000, 60), 'rest');
    expect(m.update(sample(80_000 + DEFAULT_MOTION_CONFIG.movingSustainMs, 60), 'rest')).toMatchObject({ kind: 'start_work' });
  });

  it('withdraws a work suggestion once the driver is working', () => {
    const m = new MotionSuggester();
    m.update(sample(0, 50), 'rest');
    m.update(sample(30_000, 50), 'rest');
    expect(m.suggestion).not.toBeNull();
    expect(m.update(sample(31_000, 50), 'work')).toBeNull();
  });
});

describe('Motion detection only SUGGESTS (nothing is committed without confirmation)', () => {
  it('moving samples create a suggestion but write nothing to the log', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    const before = (await h.store.list()).length;
    h.location.emit(h.clock, 55);
    h.clock.advance(1);
    h.location.emit(h.clock, 55);
    h.controller.tick();
    const snap = h.controller.getSnapshot();
    expect(snap.suggestion).toMatchObject({ kind: 'start_work' });
    expect(snap.state).toBeNull();
    expect((await h.store.list()).length).toBe(before);
    // time passes, still nothing committed
    for (let i = 0; i < 5; i++) {
      h.clock.advance(1);
      h.location.emit(h.clock, 55);
      h.controller.tick();
    }
    expect((await h.store.list()).length).toBe(before);
    expect(h.controller.getSnapshot().state).toBeNull();
  });

  it('is only recorded after the driver confirms, and the entry is back-dated to when movement began', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    const moveStart = h.clock.ms;
    h.location.emit(h.clock, 55);
    h.clock.advance(1);
    h.location.emit(h.clock, 55);
    // driver stops (speed 0) and confirms
    h.clock.advance(3);
    h.location.emit(h.clock, 0);
    expect(h.controller.getSnapshot().interactionAllowed).toBe(true);
    const before = (await h.store.list()).length;
    const res = await h.controller.confirmSuggestion();
    expect(res.ok).toBe(true);
    const list = await h.store.list();
    expect(list.length).toBe(before + 1);
    const last = list[list.length - 1]!;
    expect(last.type).toBe('state_change');
    expect(last.payload).toMatchObject({ state: 'work', source: 'suggestion', at: new Date(moveStart).toISOString() });
    expect(h.controller.getSnapshot().state).toBe('work');
    expect(h.controller.getSnapshot().suggestion).toBeNull();
  });

  it('a dismissed suggestion writes nothing and does not come back', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 55);
    h.clock.advance(1);
    h.location.emit(h.clock, 55);
    expect(h.controller.getSnapshot().suggestion).not.toBeNull();
    const before = (await h.store.list()).length;
    h.controller.dismissSuggestion();
    h.clock.advance(1);
    h.location.emit(h.clock, 55);
    expect(h.controller.getSnapshot().suggestion).toBeNull();
    expect((await h.store.list()).length).toBe(before);
  });

  it('confirming is blocked while the vehicle is still moving', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 55);
    h.clock.advance(1);
    h.location.emit(h.clock, 55);
    const before = (await h.store.list()).length;
    const res = await h.controller.confirmSuggestion();
    expect(res).toMatchObject({ ok: false, reason: 'moving' });
    expect((await h.store.list()).length).toBe(before);
  });

  it('a stopped-for-15-minutes suggestion is back-dated to when the stop began', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    await h.controller.startWork();
    h.clock.advance(60);
    const stopAt = h.clock.ms;
    h.location.emit(h.clock, 0);
    h.clock.advance(15);
    h.location.emit(h.clock, 0);
    expect(h.controller.getSnapshot().suggestion).toMatchObject({ kind: 'start_rest' });
    expect(h.controller.getSnapshot().state).toBe('work');
    await h.controller.confirmSuggestion();
    const last = (await h.store.list()).at(-1)!;
    expect(last.payload).toMatchObject({ state: 'rest', at: new Date(stopAt).toISOString(), restLocation: 'stationary_out_of_vehicle' });
  });

  it('speaks a suggestion once, not on every GPS sample', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 55);
    for (let i = 0; i < 6; i++) {
      h.clock.advance(1);
      h.location.emit(h.clock, 55);
    }
    expect(h.speech.spoken.filter((t) => /Movement detected/.test(t))).toHaveLength(1);
  });
});
