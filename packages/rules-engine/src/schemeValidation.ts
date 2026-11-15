import type { SchemeDefinition } from '@logmate/shared';

export type ValidationResult = { ok: true; scheme: SchemeDefinition } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

const FAMILIES = ['standard', 'bfm', 'afm', 'ach', 'exemption', 'custom'];
const CATEGORIES = ['minor', 'substantial', 'severe', 'critical'];

function checkKeys(o: Obj, allowed: string[], path: string, errors: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`${path}.${k} is not a recognised property`);
}

function checkTiers(v: unknown, path: string, bound: 'maxActual' | 'minActual', errors: string[]): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || v.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  let prev: number | undefined;
  v.forEach((t: unknown, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(t)) return errors.push(`${p} must be an object`);
    checkKeys(t, ['category', bound], p, errors);
    if (!CATEGORIES.includes(t.category as string)) errors.push(`${p}.category must be one of ${CATEGORIES.join(', ')}`);
    const b = t[bound];
    const isLast = i === v.length - 1;
    if (isLast && b !== undefined) errors.push(`${p}.${bound} must be omitted on the last tier`);
    if (!isLast) {
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 0) errors.push(`${p}.${bound} must be a non-negative integer`);
      else {
        if (prev !== undefined && (bound === 'maxActual' ? b <= prev : b >= prev)) errors.push(`${p}.${bound} must be ${bound === 'maxActual' ? 'increasing' : 'decreasing'}`);
        prev = b;
      }
    }
  });
}

function checkRestReq(r: unknown, period: number, path: string, errors: string[]): void {
  if (!isObj(r)) return void errors.push(`${path} must be an object`);
  checkKeys(
    r,
    ['id', 'description', 'total', 'minBlock', 'continuous', 'stationary', 'allowSleeperMoving', 'nightRest', 'count', 'consecutive', 'afterMaxWork', 'exclusiveGroup', 'splitRestDefence', 'tiers'],
    path,
    errors,
  );
  if (!isStr(r.id)) errors.push(`${path}.id must be a non-empty string`);
  if (typeof r.description !== 'string') errors.push(`${path}.description must be a string`);
  if (!isPosInt(r.total) || r.total > period) errors.push(`${path}.total must be a positive integer number of minutes not exceeding the period`);
  if (!isPosInt(r.minBlock) || r.minBlock < 15) errors.push(`${path}.minBlock must be an integer >= 15 (rest under 15 minutes never counts)`);
  else if (isPosInt(r.total) && r.minBlock > r.total) errors.push(`${path}.minBlock must not exceed total`);
  if (typeof r.continuous !== 'boolean') errors.push(`${path}.continuous must be boolean`);
  if (typeof r.stationary !== 'boolean') errors.push(`${path}.stationary must be boolean`);
  for (const k of ['allowSleeperMoving', 'nightRest', 'consecutive'] as const) {
    if (r[k] !== undefined && typeof r[k] !== 'boolean') errors.push(`${path}.${k} must be boolean`);
  }
  if (r.count !== undefined && !isPosInt(r.count)) errors.push(`${path}.count must be a positive integer`);
  if (r.consecutive && !r.nightRest) errors.push(`${path}.consecutive is only valid with nightRest`);
  if (r.nightRest && (r.stationary !== true || r.continuous !== true)) errors.push(`${path}: a night rest break is continuous stationary rest (set continuous and stationary to true)`);
  if (r.nightRest && r.total !== 420) errors.push(`${path}.total must be 420 for a night rest break (7 continuous hours, HVNL s5)`);
  if (r.afterMaxWork !== undefined && (!isPosInt(r.afterMaxWork) || r.afterMaxWork > period)) errors.push(`${path}.afterMaxWork must be a positive integer not exceeding the period`);
  if (r.exclusiveGroup !== undefined && !isStr(r.exclusiveGroup)) errors.push(`${path}.exclusiveGroup must be a non-empty string`);
  if (r.splitRestDefence !== undefined) {
    const s = r.splitRestDefence;
    if (!isObj(s) || !Array.isArray(s.blocks) || s.blocks.length !== 2 || !s.blocks.every(isPosInt)) {
      errors.push(`${path}.splitRestDefence.blocks must be two positive integers`);
    }
  }
  checkTiers(r.tiers, `${path}.tiers`, 'minActual', errors);
}

function checkRule(r: unknown, path: string, errors: string[], longNight: boolean): void {
  if (!isObj(r)) return void errors.push(`${path} must be an object`);
  checkKeys(r, ['id', 'description', 'period', 'countFrom', 'majorRest', 'maxWork', 'minRest', 'source'], path, errors);
  if (!isStr(r.id)) errors.push(`${path}.id must be a non-empty string`);
  if (typeof r.description !== 'string') errors.push(`${path}.description must be a string`);
  if (typeof r.source !== 'string') errors.push(`${path}.source must be a string`);
  const period = r.period;
  if (!isPosInt(period) || period % 15 !== 0) {
    errors.push(`${path}.period must be a positive whole number of minutes, a multiple of 15`);
    return;
  }
  if (r.countFrom !== 'any_rest' && r.countFrom !== 'relevant_major_rest') errors.push(`${path}.countFrom must be 'any_rest' or 'relevant_major_rest'`);
  if (r.countFrom === 'relevant_major_rest') {
    if (period < 1440) errors.push(`${path}: periods under 24 hours are counted from any rest (HVNL s247 / NHVR Counting time)`);
    if (!Array.isArray(r.majorRest) || r.majorRest.length === 0) errors.push(`${path}.majorRest must list at least one qualifying major rest`);
  }
  if (r.majorRest !== undefined) {
    if (!Array.isArray(r.majorRest)) errors.push(`${path}.majorRest must be an array`);
    else
      r.majorRest.forEach((m: unknown, i) => {
        const p = `${path}.majorRest[${i}]`;
        if (!isObj(m)) return errors.push(`${p} must be an object`);
        checkKeys(m, ['minContinuous', 'stationary', 'allowSleeperMoving', 'nightRest', 'splitRestOnly'], p, errors);
        if (!isPosInt(m.minContinuous)) errors.push(`${p}.minContinuous must be a positive integer`);
        if (typeof m.stationary !== 'boolean') errors.push(`${p}.stationary must be boolean`);
        for (const k of ['allowSleeperMoving', 'nightRest', 'splitRestOnly'] as const) {
          if (m[k] !== undefined && typeof m[k] !== 'boolean') errors.push(`${p}.${k} must be boolean`);
        }
      });
  }
  if (r.maxWork === undefined && (r.minRest === undefined || (Array.isArray(r.minRest) && r.minRest.length === 0))) {
    errors.push(`${path} must have maxWork and/or minRest`);
  }
  if (r.maxWork !== undefined) {
    const mw = r.maxWork;
    if (!isObj(mw)) errors.push(`${path}.maxWork must be an object`);
    else {
      checkKeys(mw, ['minutes', 'measure', 'tiers'], `${path}.maxWork`, errors);
      if (!isPosInt(mw.minutes) || mw.minutes > period) errors.push(`${path}.maxWork.minutes must be a positive integer not exceeding the period`);
      if (mw.measure !== 'work' && mw.measure !== 'long_night') errors.push(`${path}.maxWork.measure must be 'work' or 'long_night'`);
      if (mw.measure === 'long_night' && !longNight) errors.push(`${path}.maxWork.measure 'long_night' requires scheme.longNight`);
      checkTiers(mw.tiers, `${path}.maxWork.tiers`, 'maxActual', errors);
    }
  }
  if (r.minRest !== undefined) {
    if (!Array.isArray(r.minRest)) errors.push(`${path}.minRest must be an array`);
    else {
      const ids = new Set<string>();
      r.minRest.forEach((q: unknown, i) => {
        checkRestReq(q, period, `${path}.minRest[${i}]`, errors);
        const id = isObj(q) ? q.id : undefined;
        if (typeof id === 'string') {
          if (ids.has(id)) errors.push(`${path}.minRest[${i}].id "${id}" is duplicated`);
          ids.add(id);
        }
      });
    }
  }
}

/** Validate an unknown value as a SchemeDefinition. */
export function validateScheme(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(value)) return { ok: false, errors: ['scheme must be an object'] };
  const s = value;
  checkKeys(s, ['schemaVersion', 'id', 'name', 'family', 'arrangement', 'version', 'verifiedOn', 'sources', 'rules', 'longNight', 'switchingOut', 'resetRestMinutes', 'description'], 'scheme', errors);
  if (s.schemaVersion !== 1) errors.push('scheme.schemaVersion must be 1');
  if (!isStr(s.id)) errors.push('scheme.id must be a non-empty string');
  if (!isStr(s.name)) errors.push('scheme.name must be a non-empty string');
  if (!FAMILIES.includes(s.family as string)) errors.push(`scheme.family must be one of ${FAMILIES.join(', ')}`);
  if (s.arrangement !== 'solo' && s.arrangement !== 'two_up') errors.push(`scheme.arrangement must be 'solo' or 'two_up'`);
  if (!isStr(s.version)) errors.push('scheme.version must be a non-empty string');
  if (typeof s.verifiedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.verifiedOn)) errors.push('scheme.verifiedOn must be a YYYY-MM-DD date');
  if (!Array.isArray(s.sources) || !s.sources.every((x) => typeof x === 'string')) errors.push('scheme.sources must be an array of strings');
  if (s.switchingOut !== 'compliance_or_reset' && s.switchingOut !== 'reset_only') errors.push(`scheme.switchingOut must be 'compliance_or_reset' or 'reset_only'`);
  if (!isPosInt(s.resetRestMinutes)) errors.push('scheme.resetRestMinutes must be a positive integer');

  const hasLongNight = s.longNight !== undefined;
  if (!Array.isArray(s.rules) || s.rules.length === 0) errors.push('scheme.rules must be a non-empty array');
  else {
    const ids = new Set<string>();
    s.rules.forEach((r: unknown, i) => {
      checkRule(r, `scheme.rules[${i}]`, errors, hasLongNight);
      const id = isObj(r) ? r.id : undefined;
      if (typeof id === 'string') {
        if (ids.has(id)) errors.push(`scheme.rules[${i}].id "${id}" is duplicated`);
        ids.add(id);
      }
    });
  }
  if (hasLongNight) {
    const ln = s.longNight;
    if (!isObj(ln)) errors.push('scheme.longNight must be an object');
    else {
      checkKeys(ln, ['dailyThreshold', 'dailyPeriodRuleId', 'nightFrom', 'nightTo', 'roundUpTo'], 'scheme.longNight', errors);
      if (!isPosInt(ln.dailyThreshold)) errors.push('scheme.longNight.dailyThreshold must be a positive integer');
      const daily = Array.isArray(s.rules) ? s.rules.find((r: unknown) => isObj(r) && r.id === ln.dailyPeriodRuleId) : undefined;
      if (!isObj(daily) || daily.period !== 1440) errors.push('scheme.longNight.dailyPeriodRuleId must reference a rule with a 24 hour (1440 minute) period');
      const okMin = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1440;
      if (!okMin(ln.nightFrom) || !okMin(ln.nightTo) || ln.nightFrom >= ln.nightTo) errors.push('scheme.longNight.nightFrom/nightTo must be minutes after local midnight with nightFrom < nightTo');
      if (!isPosInt(ln.roundUpTo)) errors.push('scheme.longNight.roundUpTo must be a positive integer');
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scheme: value as unknown as SchemeDefinition };
}

/** Parse and validate a custom scheme from JSON text (e.g. AFM / ACA-Fatigue certificate hours). */
export function loadSchemeFromJson(json: string): ValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${(e as Error).message}`] };
  }
  return validateScheme(value);
}
