import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  BFM_SOLO,
  BFM_TWO_UP,
  BUILT_IN_SCHEMES,
  STANDARD_SOLO,
  STANDARD_TWO_UP,
  evaluate,
  loadSchemeFromJson,
  schemeJsonSchema,
  validateScheme,
} from '../src/index.js';
import type { SchemeDefinition } from '../src/index.js';
import { at, ctx, schedule } from './helpers.js';

/** Max work / min rest values exactly as in the official tables (minutes). See docs/RULES_SOURCES.md. */
const OFFICIAL: Record<string, Array<[ruleId: string, period: number, maxWork: number | null, rest: Array<[string, number]>]>> = {
  'standard-solo': [
    ['std-solo-5.5h', 330, 315, [['rest-15c', 15]]],
    ['std-solo-8h', 480, 450, [['rest-30b', 30]]],
    ['std-solo-11h', 660, 600, [['rest-60b', 60]]],
    ['std-solo-24h', 1440, 720, [['rest-7h-stationary', 420]]],
    ['std-solo-7d', 10080, 4320, [['rest-24h-stationary', 1440]]],
    ['std-solo-14d', 20160, 8640, [['night-2', 420], ['night-2-consecutive', 420]]],
  ],
  'standard-two-up': [
    ['std-two-5.5h', 330, 315, [['rest-15c', 15]]],
    ['std-two-8h', 480, 450, [['rest-30b', 30]]],
    ['std-two-11h', 660, 600, [['rest-60b', 60]]],
    ['std-two-24h', 1440, 720, [['rest-5h-stationary-or-sleeper', 300]]],
    ['std-two-52h', 3120, null, [['rest-10h-stationary', 600]]],
    ['std-two-7d', 10080, 3600, [['rest-24h-stationary', 1440], ['rest-24h-in-7h-blocks', 1440]]],
    ['std-two-14d', 20160, 7200, [['night-2', 420], ['night-2-consecutive', 420]]],
  ],
  'bfm-solo': [
    ['bfm-solo-6.25h', 375, 360, [['rest-15c', 15]]],
    ['bfm-solo-9h', 540, 510, [['rest-30b', 30]]],
    ['bfm-solo-12h', 720, 660, [['rest-60b', 60]]],
    ['bfm-solo-24h', 1440, 840, [['rest-7h-stationary', 420]]],
    ['bfm-solo-7d', 10080, 2160, []],
    ['bfm-solo-14d', 20160, 8640, [['rest-24h-after-84h', 1440], ['rest-24h-stationary', 1440], ['night-2', 420], ['night-2-consecutive', 420]]],
  ],
  'bfm-two-up': [
    ['bfm-two-24h', 1440, 840, []],
    ['bfm-two-82h', 4920, null, [['rest-10h-stationary', 600]]],
    ['bfm-two-7d', 10080, 4200, [['rest-24h-stationary', 1440], ['rest-24h-in-7h-blocks', 1440]]],
    ['bfm-two-14d', 20160, 8400, [['night-4', 420]]],
  ],
};

describe('Built-in schemes are data that matches the official tables', () => {
  it.each(BUILT_IN_SCHEMES.map((s) => [s.id, s] as const))('%s matches the official values', (id, scheme) => {
    const expected = OFFICIAL[id];
    expect(expected).toBeDefined();
    expect(scheme.rules.map((r) => r.id)).toEqual(expected?.map((e) => e[0]));
    for (const [ruleId, period, maxWork, rest] of expected ?? []) {
      const r = scheme.rules.find((x) => x.id === ruleId);
      expect(r?.period, ruleId).toBe(period);
      expect(r?.maxWork?.minutes ?? null, ruleId).toBe(maxWork);
      expect((r?.minRest ?? []).map((q) => [q.id, q.total]), ruleId).toEqual(rest);
    }
  });

  it('BFM long/night: 36 h in 7 days, over 12 h in 24 h or 00:00-06:00, 15-min blocks rounded up', () => {
    expect(BFM_SOLO.longNight).toEqual({ dailyThreshold: 720, dailyPeriodRuleId: 'bfm-solo-24h', nightFrom: 0, nightTo: 360, roundUpTo: 15 });
    expect(BFM_SOLO.rules.find((r) => r.id === 'bfm-solo-7d')?.maxWork).toMatchObject({ minutes: 2160, measure: 'long_night' });
  });

  it('BFM 14 d requires 24 h rest after no more than 84 h work', () => {
    expect(BFM_SOLO.rules.find((r) => r.id === 'bfm-solo-14d')?.minRest?.[0]?.afterMaxWork).toBe(84 * 60);
  });

  it('reset rest break is 48 continuous hours for every built-in scheme (HVNL s263(5))', () => {
    for (const s of BUILT_IN_SCHEMES) expect(s.resetRestMinutes).toBe(2880);
  });

  it('every built-in scheme validates against the published JSON Schema (ajv) and the engine validator', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schemeJsonSchema);
    for (const s of BUILT_IN_SCHEMES) {
      expect(validate(s), JSON.stringify(validate.errors)).toBe(true);
      expect(validateScheme(s).ok).toBe(true);
    }
  });

  it('built-in schemes are JSON-serialisable and round-trip through loadSchemeFromJson', () => {
    for (const s of [STANDARD_SOLO, STANDARD_TWO_UP, BFM_SOLO, BFM_TWO_UP]) {
      const r = loadSchemeFromJson(JSON.stringify(s));
      expect(r.ok && r.scheme).toEqual(s);
    }
  });
});

/** An operator-specific scheme (e.g. hours from an AFM / ACA-Fatigue certificate). Values are illustrative only. */
const CUSTOM = {
  schemaVersion: 1,
  id: 'example-ach',
  name: 'Example ACH certificate hours (illustrative test data)',
  family: 'ach',
  arrangement: 'solo',
  version: '1',
  verifiedOn: '2026-11-15',
  sources: ['test fixture - not a real certificate'],
  switchingOut: 'reset_only',
  resetRestMinutes: 2880,
  rules: [
    {
      id: 'ach-6h',
      description: 'In any 6 h: max 5 1/2 h work; 15 continuous min rest',
      period: 360,
      countFrom: 'any_rest',
      maxWork: { minutes: 330, measure: 'work' },
      minRest: [{ id: 'r15', description: '15 continuous minutes', total: 15, minBlock: 15, continuous: true, stationary: false }],
      source: 'test',
    },
    {
      id: 'ach-24h',
      description: 'In any 24 h: max 13 h work; 7 h stationary rest',
      period: 1440,
      countFrom: 'relevant_major_rest',
      majorRest: [{ minContinuous: 420, stationary: true }],
      maxWork: { minutes: 780, measure: 'work' },
      minRest: [{ id: 'r7', description: '7 continuous hours stationary', total: 420, minBlock: 420, continuous: true, stationary: true }],
      source: 'test',
    },
  ],
};

describe('Custom schemes are loaded from JSON and validated', () => {
  it('a valid custom scheme loads and is evaluated with no new code', () => {
    const r = loadSchemeFromJson(JSON.stringify(CUSTOM));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = schedule('22:00', [['r', '06:00'], ['w', '11:45'], ['r', '20:00']], { day: -1 });
    const out = evaluate(ev, ctx(r.scheme));
    expect(out.breaches.map((b) => [b.ruleId, b.kind, b.actual])).toEqual([['ach-6h', 'max_work', 345]]);
    expect(out.breaches[0]?.windowStart).toBe(at(0, '06:00'));
  });

  it('invalid JSON is rejected', () => {
    const r = loadSchemeFromJson('{ not json');
    expect(r.ok).toBe(false);
  });

  // Test fixtures are deliberately mutated into invalid shapes, so they are loosely typed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loose = any;
  const mutate = (f: (s: Loose) => void): unknown => {
    const s: Loose = structuredClone(CUSTOM);
    f(s);
    return s;
  };
  const invalidCases: Array<[string, unknown, RegExp]> = [
    ['not an object', 42, /must be an object/],
    ['wrong schemaVersion', mutate((s) => (s.schemaVersion = 2)), /schemaVersion/],
    ['unknown family', mutate((s) => (s.family = 'magic')), /family/],
    ['bad arrangement', mutate((s) => (s.arrangement = 'three_up')), /arrangement/],
    ['bad verifiedOn', mutate((s) => (s.verifiedOn = 'yesterday')), /verifiedOn/],
    ['no rules', mutate((s) => (s.rules = [])), /rules/],
    ['unknown property', mutate((s) => (s.colour = 'red')), /not a recognised property/],
    ['duplicate rule id', mutate((s) => s.rules.push(structuredClone(s.rules[0]))), /duplicated/],
    ['period not multiple of 15', mutate((s) => (s.rules[0].period = 361)), /multiple of 15/],
    ['max work above period', mutate((s) => (s.rules[0].maxWork.minutes = 400)), /maxWork.minutes/],
    ['bad measure', mutate((s) => (s.rules[0].maxWork.measure = 'driving')), /measure/],
    ['long_night without definition', mutate((s) => (s.rules[0].maxWork.measure = 'long_night')), /requires scheme.longNight/],
    ['rule with neither limit', mutate((s) => (delete s.rules[0].maxWork, (s.rules[0].minRest = []))), /maxWork and\/or minRest/],
    ['minBlock under 15 minutes', mutate((s) => (s.rules[0].minRest[0].minBlock = 10)), /minBlock/],
    ['minBlock above total', mutate((s) => (s.rules[1].minRest[0].minBlock = 500)), /minBlock must not exceed total/],
    ['short period counted from major rest', mutate((s) => ((s.rules[0].countFrom = 'relevant_major_rest'), (s.rules[0].majorRest = [{ minContinuous: 60, stationary: true }]))), /under 24 hours/],
    ['major rest list missing', mutate((s) => delete s.rules[1].majorRest), /majorRest must list/],
    ['bad major rest', mutate((s) => (s.rules[1].majorRest = [{ minContinuous: -1, stationary: 'yes', nightRest: 1 }])), /minContinuous/],
    ['major rest not array', mutate((s) => (s.rules[1].majorRest = 'x')), /majorRest must be an array/],
    ['night rest not 7 h', mutate((s) => s.rules[1].minRest.push({ id: 'n', description: '', total: 400, minBlock: 400, continuous: true, stationary: true, nightRest: true })), /420/],
    ['night rest not stationary', mutate((s) => s.rules[1].minRest.push({ id: 'n', description: '', total: 420, minBlock: 420, continuous: true, stationary: false, nightRest: true })), /night rest break/],
    ['consecutive without night', mutate((s) => (s.rules[1].minRest[0].consecutive = true)), /consecutive/],
    ['bad count', mutate((s) => (s.rules[1].minRest[0].count = 0)), /count/],
    ['bad afterMaxWork', mutate((s) => (s.rules[1].minRest[0].afterMaxWork = 99999)), /afterMaxWork/],
    ['bad split defence', mutate((s) => (s.rules[1].minRest[0].splitRestDefence = { blocks: [360] })), /splitRestDefence/],
    ['bad exclusive group', mutate((s) => (s.rules[1].minRest[0].exclusiveGroup = '')), /exclusiveGroup/],
    ['duplicate requirement id', mutate((s) => s.rules[1].minRest.push(structuredClone(s.rules[1].minRest[0]))), /duplicated/],
    ['bad boolean', mutate((s) => (s.rules[1].minRest[0].allowSleeperMoving = 'yes')), /allowSleeperMoving/],
    ['tiers not increasing', mutate((s) => (s.rules[1].maxWork.tiers = [{ category: 'minor', maxActual: 800 }, { category: 'severe', maxActual: 790 }, { category: 'critical' }])), /increasing/],
    ['last tier bounded', mutate((s) => (s.rules[1].maxWork.tiers = [{ category: 'minor', maxActual: 800 }])), /omitted on the last tier/],
    ['bad tier category', mutate((s) => (s.rules[1].minRest[0].tiers = [{ category: 'awful' }])), /category/],
    ['empty tiers', mutate((s) => (s.rules[1].minRest[0].tiers = [])), /non-empty array/],
    ['rest tiers not decreasing', mutate((s) => (s.rules[1].minRest[0].tiers = [{ category: 'minor', minActual: 300 }, { category: 'severe', minActual: 350 }, { category: 'critical' }])), /decreasing/],
    ['longNight bad reference', mutate((s) => (s.longNight = { dailyThreshold: 720, dailyPeriodRuleId: 'ach-6h', nightFrom: 0, nightTo: 360, roundUpTo: 15 })), /dailyPeriodRuleId/],
    ['longNight bad window', mutate((s) => (s.longNight = { dailyThreshold: 720, dailyPeriodRuleId: 'ach-24h', nightFrom: 400, nightTo: 360, roundUpTo: 0 })), /nightFrom/],
    ['longNight not object', mutate((s) => (s.longNight = 3)), /longNight must be an object/],
    ['rule not object', mutate((s) => (s.rules[0] = 'rule')), /must be an object/],
    ['requirement not object', mutate((s) => (s.rules[0].minRest[0] = null)), /must be an object/],
    ['minRest not array', mutate((s) => (s.rules[0].minRest = {})), /minRest must be an array/],
    ['maxWork not object', mutate((s) => (s.rules[0].maxWork = 5)), /maxWork must be an object/],
  ];
  it.each(invalidCases)('rejects: %s', (_name, value, pattern) => {
    const r = validateScheme(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(pattern);
  });

  it('evaluate() refuses an invalid scheme with an invalid_input status', () => {
    const r = evaluate([], ctx({ ...STANDARD_SOLO, rules: [] } as SchemeDefinition));
    expect(r.status.kind).toBe('invalid_input');
  });
});
