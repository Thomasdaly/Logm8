import type { EvaluationContext, WorkRestEvent } from '@logmate/shared';
import { prepare } from './evaluate.js';
import { longNightIn, longNightMask } from './longNight.js';
import { formatInstant, parseInstant } from './time.js';
import { NONE, REST_OTHER, REST_SLEEPER_MOVING, REST_STATIONARY, WORK, buildTimeline, nightRestDays, segments } from './timeline.js';

export { evaluate, RULESET_VERSION } from './evaluate.js';
export { forecast } from './forecast.js';
export { validateScheme, loadSchemeFromJson, type ValidationResult } from './schemeValidation.js';
export { schemeJsonSchema } from './schemeJsonSchema.js';
export { checkJurisdiction } from './jurisdiction.js';
export { STANDARD_SOLO, STANDARD_TWO_UP, BFM_SOLO, BFM_TWO_UP, BUILT_IN_SCHEMES } from './schemes/index.js';
export type * from '@logmate/shared';

export type CountedKind = 'work' | 'rest_stationary' | 'rest_sleeper_moving' | 'rest_other' | 'not_recorded';

export interface CountedSegment {
  start: string;
  end: string;
  kind: CountedKind;
}

const KIND: Record<number, CountedKind> = {
  [NONE]: 'not_recorded',
  [WORK]: 'work',
  [REST_STATIONARY]: 'rest_stationary',
  [REST_SLEEPER_MOVING]: 'rest_sleeper_moving',
  [REST_OTHER]: 'rest_other',
};

export type AnalysisResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function timelineFor(events: readonly WorkRestEvent[], ctx: EvaluationContext) {
  const p = prepare(events, ctx);
  if (!p.ok) {
    const st = p.result.status;
    return { ok: false as const, errors: st.kind === 'invalid_input' ? st.errors : st.kind === 'unsupported_jurisdiction' ? [st.message] : [] };
  }
  return { ok: true as const, tl: buildTimeline(p.value.events, { mode: ctx.recordingMode, timeZone: ctx.baseTimeZone }) };
}

/**
 * The record as the engine counts it: written mode in clock-aligned 15-minute blocks (work rounded
 * outward, rest inward); electronic mode per minute.
 */
export function countedTimeline(events: readonly WorkRestEvent[], ctx: EvaluationContext): AnalysisResult<CountedSegment[]> {
  const t = timelineFor(events, ctx);
  if (!t.ok) return t;
  return {
    ok: true,
    value: segments(t.tl).map((s) => ({ start: formatInstant(s.start), end: formatInstant(s.end), kind: KIND[s.state] ?? 'not_recorded' })),
  };
}

/** Local dates (YYYY-MM-DD, base time zone) on which a night rest break was taken. */
export function nightRestBreakDates(events: readonly WorkRestEvent[], ctx: EvaluationContext): AnalysisResult<string[]> {
  const t = timelineFor(events, ctx);
  if (!t.ok) return t;
  const days = [...nightRestDays(t.tl, t.tl.t0, t.tl.end)].sort((a, b) => a - b);
  return { ok: true, value: days.map((d) => new Date(d * 86_400_000).toISOString().slice(0, 10)) };
}

/** Long/night work minutes in [from, to) for a scheme that defines long/night work time. */
export function longNightMinutes(events: readonly WorkRestEvent[], ctx: EvaluationContext, from: string, to: string): AnalysisResult<number> {
  const t = timelineFor(events, ctx);
  if (!t.ok) return t;
  const def = ctx.scheme.longNight;
  const daily = ctx.scheme.rules.find((r) => r.id === def?.dailyPeriodRuleId);
  if (!def || !daily) return { ok: false, errors: [`scheme ${ctx.scheme.id} does not define long/night work time`] };
  const a = parseInstant(from);
  const b = parseInstant(to);
  if (a === null || b === null) return { ok: false, errors: ['from/to must be ISO 8601 instants'] };
  return { ok: true, value: longNightIn(t.tl, longNightMask(t.tl, def, daily), def, a, b).minutes };
}
