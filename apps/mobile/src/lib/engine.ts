import {
  evaluate,
  forecast as engineForecast,
  type EvaluationContext,
  type EvaluationResult,
  type Forecast,
  type LimitForecast,
  type SchemeDefinition,
} from '@logmate/rules-engine';
import { schemeFor } from './profile';
import { type ProfileVersion, type StateEntry, toWorkRestEvents, trimHistory } from './projection';

/**
 * Builds the rules-engine context from the profile history. The first profile sets the scheme; every later
 * profile that changes the scheme becomes a scheme change at the time it was recorded, so the engine applies
 * the HVNL s263 switching rules (48 h reset, or full compliance with the new option).
 */
export function buildContext(history: readonly ProfileVersion[]): EvaluationContext | null {
  const first = history[0];
  const last = history[history.length - 1];
  if (!first || !last) return null;
  const changes: NonNullable<EvaluationContext['schemeChanges']> = [];
  let current = schemeFor(first.profile.schemeFamily, first.profile.twoUp);
  for (const v of history.slice(1)) {
    const s = schemeFor(v.profile.schemeFamily, v.profile.twoUp);
    if (s.id !== current.id) {
      changes.push({ at: v.at, scheme: s });
      current = s;
    }
  }
  const ctx: EvaluationContext = {
    baseTimeZone: last.profile.baseTimeZone,
    recordingMode: 'written',
    scheme: schemeFor(first.profile.schemeFamily, first.profile.twoUp),
  };
  if (changes.length > 0) ctx.schemeChanges = changes;
  return ctx;
}

export function currentScheme(ctx: EvaluationContext): SchemeDefinition {
  return ctx.schemeChanges?.[ctx.schemeChanges.length - 1]?.scheme ?? ctx.scheme;
}

export function runForecast(entries: readonly StateEntry[], ctx: EvaluationContext, now: string, historyDays = 17): Forecast {
  return engineForecast(trimHistory(toWorkRestEvents(entries, now), now, historyDays), ctx, now);
}

/** Rules with a period up to 82 h (the longest short-period rule: BFM two-up) are the "fast" tier. */
const FAST_MAX_PERIOD_MIN = 82 * 60;

function mapSchemes(ctx: EvaluationContext, fn: (s: SchemeDefinition) => SchemeDefinition | null): EvaluationContext | null {
  const base = fn(ctx.scheme);
  if (!base) return null;
  const changes: NonNullable<EvaluationContext['schemeChanges']> = [];
  for (const c of ctx.schemeChanges ?? []) {
    const s = fn(c.scheme);
    if (!s) return null;
    changes.push({ at: c.at, scheme: s });
  }
  const out: EvaluationContext = { ...ctx, scheme: base };
  if (changes.length > 0) out.schemeChanges = changes;
  else delete out.schemeChanges;
  return out;
}

/**
 * The forecast is CPU-heavy on a phone, so it is split by scheme data (no engine change):
 *  - fast: rules up to 82 h, needing only ~6 days of history. Shown immediately.
 *  - slow: the 7 and 14 day rules (plus the 24 h rule that BFM long/night counting needs), 17 days of history.
 *    Computed afterwards and merged in.
 * Returns null for `slow` when the scheme has no long rules.
 */
export function tierContexts(ctx: EvaluationContext): { fast: EvaluationContext; slow: EvaluationContext | null } {
  const fast = mapSchemes(ctx, (s) => {
    const rules = s.rules.filter((r) => r.period <= FAST_MAX_PERIOD_MIN);
    return rules.length > 0 ? { ...s, rules } : null;
  });
  const slow = mapSchemes(ctx, (s) => {
    const daily = s.longNight?.dailyPeriodRuleId;
    const rules = s.rules.filter((r) => r.period > FAST_MAX_PERIOD_MIN || r.id === daily);
    return rules.some((r) => r.period > FAST_MAX_PERIOD_MIN) ? { ...s, rules } : null;
  });
  return fast && slow ? { fast, slow } : { fast: ctx, slow: null };
}

export const FAST_HISTORY_DAYS = 6;

/** Merge the fast and slow forecasts: the earliest limit overall wins. */
export function mergeForecasts(fast: Forecast, slow: Forecast | null): Forecast {
  if (!slow || slow.status !== 'ok' || fast.status !== 'ok') return fast;
  const limits = [...fast.limits, ...slow.limits].sort((a, b) => a.minutesUntilBreach - b.minutesUntilBreach || a.period - b.period);
  const first = limits[0];
  if (!first) return fast;
  const src = slow.earliest && slow.earliest.minutesUntilBreach < (fast.earliest?.minutesUntilBreach ?? Infinity) ? slow : fast;
  return { ...src, limits, earliest: src.earliest, minutesToEarliest: src.minutesToEarliest };
}

export function runEvaluate(entries: readonly StateEntry[], ctx: EvaluationContext, now: string): EvaluationResult {
  return evaluate(trimHistory(toWorkRestEvents(entries, now), now), ctx);
}

/** Human-readable name of a limit, taken from the scheme data. */
export function limitLabel(ctx: EvaluationContext, limit: LimitForecast | null): string {
  if (!limit) return '';
  const scheme = currentScheme(ctx);
  const rule = scheme.rules.find((r) => r.id === limit.ruleId);
  if (!rule) return limit.ruleId;
  if (limit.kind === 'min_rest') {
    const req = rule.minRest?.find((q) => q.id === limit.requirementId);
    return req ? `Rest: ${req.description}.` : rule.description;
  }
  return rule.description.split(';')[0] ?? rule.description;
}
