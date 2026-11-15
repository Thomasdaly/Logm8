import { WARNING_THRESHOLDS, WarningTracker, warningText } from '../src/lib/warnings';
import { makeHarness } from './helpers/fakes';
import { PROFILE } from './helpers/testDb';

describe('WarningTracker', () => {
  it('uses the 60/30/15/5 minute thresholds from SPEC §5', () => {
    expect(WARNING_THRESHOLDS).toEqual([60, 30, 15, 5]);
  });

  it('fires each threshold once, in order, and then "limit reached"', () => {
    const t = new WarningTracker();
    const fired: number[] = [];
    for (let m = 90; m >= -1; m -= 1) {
      const f = t.check('ep', m, 'limit');
      if (f) fired.push(f.threshold);
    }
    expect(fired).toEqual([60, 30, 15, 5, 0]);
  });

  it('when several thresholds were crossed at once only the most urgent is announced', () => {
    const t = new WarningTracker();
    expect(t.check('ep', 12, 'x')?.threshold).toBe(15);
    expect(t.check('ep', 11, 'x')).toBeNull();
    expect(t.check('ep', 4, 'x')?.threshold).toBe(5);
  });

  it('starts again for a new episode and ignores a null forecast', () => {
    const t = new WarningTracker();
    expect(t.check('a', 50, 'x')?.threshold).toBe(60);
    expect(t.check('a', 50, 'x')).toBeNull();
    expect(t.check('b', 50, 'x')?.threshold).toBe(60);
    expect(t.check('b', null, 'x')).toBeNull();
    t.reset();
    expect(t.check('b', 50, 'x')?.threshold).toBe(60);
  });

  it('words the spoken text', () => {
    expect(warningText(15, 'Limit A')).toBe('15 minutes until a required rest. Limit A');
    expect(warningText(0, 'Limit A')).toMatch(/^Limit reached/);
  });
});

/** Walks a mocked clock forward a minute at a time and records the minute each warning was spoken. */
async function walk(h: Awaited<ReturnType<typeof makeHarness>>, minutes: number): Promise<Array<{ min: number; text: string }>> {
  const out: Array<{ min: number; text: string }> = [];
  let seen = h.speech.spoken.length;
  for (let m = 1; m <= minutes; m++) {
    h.clock.advance(1);
    h.controller.tick();
    for (const text of h.speech.spoken.slice(seen)) out.push({ min: m, text });
    seen = h.speech.spoken.length;
  }
  return out;
}

describe('warning flow with a mocked clock (60/30/15/5 minutes before the earliest limit)', () => {
  it('Standard solo starting work at 06:00: first limit is 5¼ h in any 5½ h, so warnings fire at 4h15, 4h45, 5h00, 5h10 and the limit at 5h15', async () => {
    const h = await makeHarness();
    await h.controller.startWork();
    const f = h.controller.getSnapshot().forecast!;
    expect(f.earliest?.ruleId).toBe('std-solo-5.5h');
    expect(f.minutesToEarliest).toBe(315);

    const fired = await walk(h, 330);
    expect(fired.map((x) => x.min)).toEqual([255, 285, 300, 310, 315]);
    expect(fired.map((x) => x.text.split(' ')[0])).toEqual(['60', '30', '15', '5', 'Limit']);
    expect(fired[0]?.text).toMatch(/^60 minutes until a required rest\. In any 5 1\/2 hours: max 5 1\/4 h work/);
  });

  it('shows a glanceable banner whose level escalates info → warning → critical', async () => {
    const h = await makeHarness();
    await h.controller.startWork();
    expect(h.controller.getSnapshot().banner).toBeNull();
    h.clock.advance(255);
    h.controller.tick();
    expect(h.controller.getSnapshot().banner).toMatchObject({ level: 'info', threshold: 60, text: '60 min to required rest' });
    h.clock.advance(30);
    h.controller.tick();
    expect(h.controller.getSnapshot().banner).toMatchObject({ level: 'warning', threshold: 30 });
    h.clock.advance(15);
    h.controller.tick();
    expect(h.controller.getSnapshot().banner).toMatchObject({ level: 'warning', threshold: 15 });
    h.clock.advance(10);
    h.controller.tick();
    expect(h.controller.getSnapshot().banner).toMatchObject({ level: 'critical', threshold: 5 });
    h.clock.advance(5);
    h.controller.tick();
    expect(h.controller.getSnapshot().banner).toMatchObject({ level: 'critical', threshold: 0, text: 'Limit reached. Rest now.' });
  });

  it('the live countdown falls one second per second while working', async () => {
    const h = await makeHarness();
    await h.controller.startWork();
    expect(h.controller.getSnapshot().countdownSec).toBe(315 * 60);
    h.clock.ms += 90_000;
    h.controller.tick();
    expect(h.controller.getSnapshot().countdownSec).toBe(315 * 60 - 90);
  });

  it('after a 15 minute rest the warnings start again for the next work period', async () => {
    const h = await makeHarness();
    await h.controller.startWork();
    await walk(h, 270); // past the 60 minute warning
    expect(h.speech.spoken).toHaveLength(1);
    await h.controller.startRest();
    expect(h.controller.getSnapshot().banner).toBeNull();
    const quiet = await walk(h, 15);
    expect(quiet).toEqual([]);
    await h.controller.startWork();
    h.speech.spoken.length = 0;
    const fired = await walk(h, 260);
    expect(fired[0]?.text).toMatch(/^60 minutes until/);
  });

  it('opening the app with 12 minutes left announces 15 minutes once (not 60/30/15 together)', async () => {
    const h = await makeHarness();
    await h.controller.startWork();
    h.clock.advance(303);
    h.controller.tick();
    expect(h.speech.spoken).toHaveLength(1);
    expect(h.speech.spoken[0]).toMatch(/^15 minutes/);
  });

  it('makes no warnings while resting', async () => {
    const h = await makeHarness();
    await h.controller.startWork();
    await h.controller.startRest();
    h.speech.spoken.length = 0;
    expect(await walk(h, 120)).toEqual([]);
    expect(h.controller.getSnapshot().banner).toBeNull();
  });

  it('warnings keep working when the driver is moving (audio is the only output)', async () => {
    const h = await makeHarness();
    await h.controller.enableLocation();
    await h.controller.startWork();
    h.speech.spoken.length = 0;
    for (let m = 1; m <= 256; m++) {
      h.clock.advance(1);
      h.location.emit(h.clock, 90);
      h.controller.tick();
    }
    const snap = h.controller.getSnapshot();
    expect(snap.interactionAllowed).toBe(false);
    expect(h.speech.spoken).toHaveLength(1);
    expect(h.speech.spoken[0]).toMatch(/^60 minutes/);
    expect(snap.banner?.threshold).toBe(60);
  });

  it('BFM two-up limits are used when the profile says so', async () => {
    const h = await makeHarness({ profile: { ...PROFILE, schemeFamily: 'bfm', twoUp: true } });
    await h.controller.startWork();
    expect(h.controller.getSnapshot().forecast?.earliest?.ruleId).toBe('bfm-two-24h');
    expect(h.controller.getSnapshot().countdownSec).toBe(14 * 3600);
  });
});
