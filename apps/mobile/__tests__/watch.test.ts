import { WATCH_PROTOCOL_VERSION, buildWatchContext, contextChanged, parseWatchCommand } from '../src/lib/watch';
import { PROFILE } from './helpers/testDb';
import { MIN, T0, makeHarness } from './helpers/fakes';

const v = WATCH_PROTOCOL_VERSION;

describe('Apple Watch protocol', () => {
  it('rejects malformed, unknown or wrong-version commands instead of guessing', () => {
    expect(parseWatchCommand(null).ok).toBe(false);
    expect(parseWatchCommand({ v, action: 'start_work' }).ok).toBe(false); // no id
    expect(parseWatchCommand({ v: 99, id: 'a', action: 'start_work' })).toMatchObject({ ok: false, message: expect.stringContaining('Update') });
    expect(parseWatchCommand({ v, id: 'a', action: 'delete_event' }).ok).toBe(false);
    expect(parseWatchCommand({ v, id: 'a', action: 'start_rest', restLocation: 'beach' }).ok).toBe(false);
    expect(parseWatchCommand({ v, id: 'a', action: 'start_rest', restLocation: 'sleeper_berth_stationary' })).toMatchObject({ ok: true });
  });

  it('only sets a limit time (for watch alerts) while working, and offers sleeper-moving to two-up only', () => {
    const base = { nowMs: T0, setupDone: true, twoUp: false, restLocation: null, stateSinceMs: T0, countdownSec: 3600, limitLabel: '5½ h', interactionAllowed: true };
    expect(buildWatchContext({ ...base, state: 'work' }).limitAtMs).toBe(T0 + 3600_000);
    expect(buildWatchContext({ ...base, state: 'rest' }).limitAtMs).toBeNull();
    expect(buildWatchContext({ ...base, state: 'work' }).alertMinutes).toEqual([60, 30, 15, 5, 0]);
    expect(buildWatchContext({ ...base, state: 'work' }).restPlaces.map((p) => p.value)).not.toContain('sleeper_berth_moving');
    expect(buildWatchContext({ ...base, state: 'work', twoUp: true }).restPlaces.map((p) => p.value)).toContain('sleeper_berth_moving');
  });

  it('does not resend a context for countdown rounding drift, but does for a real change', () => {
    const base = { nowMs: T0, setupDone: true, twoUp: false, state: 'work' as const, restLocation: null, stateSinceMs: T0, countdownSec: 3600, limitLabel: 'x', interactionAllowed: true };
    const a = buildWatchContext(base);
    expect(contextChanged(a, buildWatchContext({ ...base, nowMs: T0 + 10_000, countdownSec: 3590 + 5 }))).toBe(false);
    expect(contextChanged(a, buildWatchContext({ ...base, countdownSec: 3000 }))).toBe(true);
    expect(contextChanged(a, buildWatchContext({ ...base, interactionAllowed: false }))).toBe(true);
    expect(contextChanged(a, buildWatchContext({ ...base, state: 'rest' }))).toBe(true);
  });
});

describe('Apple Watch: phone controller', () => {
  it('pushes the current state to the watch on load and after logging', async () => {
    const h = await makeHarness();
    expect(h.watch.last).toMatchObject({ setupDone: true, state: null });
    await h.controller.startWork();
    expect(h.watch.last).toMatchObject({ state: 'work', stateSinceMs: T0 });
    expect(h.watch.last?.limitAtMs).toBeGreaterThan(T0);
  });

  it('a watch Start Work press is recorded by the phone with source "watch", phone time and phone GPS', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 0);
    const reply = await h.watch.press({ v, id: 'p1', action: 'start_work' });
    expect(reply).toMatchObject({ id: 'p1', ok: true, context: { state: 'work' } });
    const last = (await h.store.list()).at(-1)!;
    expect(last.payload).toMatchObject({ state: 'work', source: 'watch', at: new Date(T0).toISOString() });
    expect(last.position).toMatchObject({ lat: -27.47 });
  });

  it('a watch Start Rest press records the chosen rest place', async () => {
    const h = await makeHarness();
    await h.watch.press({ v, id: 'p1', action: 'start_work' });
    h.clock.advance(30);
    const reply = await h.watch.press({ v, id: 'p2', action: 'start_rest', restLocation: 'sleeper_berth_stationary' });
    expect(reply.ok).toBe(true);
    expect((await h.store.list()).at(-1)?.payload).toMatchObject({ state: 'rest', restLocation: 'sleeper_berth_stationary', source: 'watch', at: new Date(T0 + 30 * MIN).toISOString() });
    expect(h.watch.last).toMatchObject({ state: 'rest', restLocation: 'sleeper_berth_stationary', limitAtMs: null });
  });

  it('the driving lock applies to watch presses: nothing is recorded above 10 km/h', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 0);
    await h.controller.startWork();
    const before = (await h.store.list()).length;
    h.location.emit(h.clock, 60);
    expect(h.watch.last?.interactionAllowed).toBe(false);
    const reply = await h.watch.press({ v, id: 'p1', action: 'start_rest', restLocation: 'stationary_out_of_vehicle' });
    expect(reply).toMatchObject({ ok: false, reason: 'moving' });
    expect((await h.store.list()).length).toBe(before);
  });

  it('rejects a press before setup, a duplicate state, and sleeper-moving for a solo driver', async () => {
    const none = await makeHarness({ profile: null });
    expect(await none.watch.press({ v, id: 'a', action: 'start_work' })).toMatchObject({ ok: false, reason: 'no_profile' });

    const solo = await makeHarness();
    await solo.watch.press({ v, id: 'b', action: 'start_work' });
    expect(await solo.watch.press({ v, id: 'c', action: 'start_work' })).toMatchObject({ ok: false, reason: 'already' });
    const before = (await solo.store.list()).length;
    expect(await solo.watch.press({ v, id: 'd', action: 'start_rest', restLocation: 'sleeper_berth_moving' })).toMatchObject({ ok: false });
    expect((await solo.store.list()).length).toBe(before);

    const twoUp = await makeHarness({ profile: { ...PROFILE, twoUp: true } });
    expect(await twoUp.watch.press({ v, id: 'e', action: 'start_rest', restLocation: 'sleeper_berth_moving' })).toMatchObject({ ok: true });
  });

  it('a malformed watch message writes nothing', async () => {
    const h = await makeHarness();
    const before = (await h.store.list()).length;
    expect(await h.watch.press('garbage')).toMatchObject({ ok: false });
    expect((await h.store.list()).length).toBe(before);
  });

  it('the hash chain still verifies after watch presses', async () => {
    const h = await makeHarness();
    await h.watch.press({ v, id: 'a', action: 'start_work' });
    h.clock.advance(20);
    await h.watch.press({ v, id: 'b', action: 'start_rest', restLocation: 'stationary_out_of_vehicle' });
    expect(await h.controller.verifyIntegrity()).toMatchObject({ ok: true, count: 3 });
  });
});
