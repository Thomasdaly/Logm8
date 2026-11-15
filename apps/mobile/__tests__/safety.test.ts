import { MAX_INTERACTION_SPEED_KMH, isInteractionAllowed } from '../src/lib/safety';
import { makeHarness } from './helpers/fakes';

describe('isInteractionAllowed(speedKmh) (SPEC §5)', () => {
  it('blocks interactive UI strictly above 10 km/h', () => {
    expect(MAX_INTERACTION_SPEED_KMH).toBe(10);
    expect(isInteractionAllowed(10.01)).toBe(false);
    expect(isInteractionAllowed(11)).toBe(false);
    expect(isInteractionAllowed(100)).toBe(false);
  });
  it('allows interaction at or below 10 km/h', () => {
    expect(isInteractionAllowed(0)).toBe(true);
    expect(isInteractionAllowed(9.99)).toBe(true);
    expect(isInteractionAllowed(10)).toBe(true);
  });
  it('allows interaction when speed is unknown (GPS unavailable or permission denied)', () => {
    expect(isInteractionAllowed(null)).toBe(true);
    expect(isInteractionAllowed(undefined)).toBe(true);
    expect(isInteractionAllowed(NaN)).toBe(true);
  });
});

describe('controller applies the speed gate', () => {
  it('refuses to log work/rest/correct/profile changes above 10 km/h, with no write', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 62);
    h.controller.tick();
    const snap = h.controller.getSnapshot();
    expect(snap.interactionAllowed).toBe(false);
    expect(snap.speedKmh).toBeCloseTo(62);
    const before = (await h.store.list()).length;
    expect(await h.controller.startWork()).toMatchObject({ ok: false, reason: 'moving' });
    expect(await h.controller.startRest()).toMatchObject({ ok: false, reason: 'moving' });
    expect(await h.controller.correct(1, 'x', { void: true })).toMatchObject({ ok: false, reason: 'moving' });
    expect(await h.controller.saveProfile(snap.profile!)).toMatchObject({ ok: false, reason: 'moving' });
    expect((await h.store.list()).length).toBe(before);
  });

  it('allows logging again once the vehicle has stopped', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 62);
    h.clock.advance(1);
    h.location.emit(h.clock, 0);
    expect(h.controller.getSnapshot().interactionAllowed).toBe(true);
    expect(await h.controller.startWork()).toEqual({ ok: true });
  });

  it('a speed reading that is more than 2 minutes old is treated as unknown (GPS lost)', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    h.location.emit(h.clock, 62);
    h.controller.tick();
    expect(h.controller.getSnapshot().interactionAllowed).toBe(false);
    h.clock.advance(3);
    h.controller.tick();
    expect(h.controller.getSnapshot().interactionAllowed).toBe(true);
    expect(h.controller.getSnapshot().speedKmh).toBeNull();
  });

  it('works with no location permission at all (manual logging)', async () => {
    const h = await makeHarness();
    expect(h.controller.getSnapshot().locationStatus).toBe('denied');
    expect(await h.controller.startWork()).toEqual({ ok: true });
  });
});
