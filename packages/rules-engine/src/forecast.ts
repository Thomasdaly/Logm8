import type { Breach, EvaluationContext, Forecast, LimitForecast, SchemeDefinition, WorkRestEvent } from '@logmate/shared';
import { RULESET_VERSION, type PreparedInput, evaluatePrepared, prepare } from './evaluate.js';
import { formatInstant, parseInstant } from './time.js';
import { type ParsedEvent, REST_STATIONARY, WORK } from './timeline.js';

const MAX_REST_SEARCH = 48 * 60;

type Key = string;
const keyOf = (b: Breach): Key => `${b.schemeId}|${b.ruleId}|${b.kind}|${b.requirementId ?? ''}|${b.windowStart}`;
const limitKey = (b: Pick<Breach, 'ruleId' | 'kind' | 'requirementId'>): string => `${b.ruleId}|${b.kind}|${b.requirementId ?? ''}`;

const syntheticSource = (kind: 'work' | 'rest'): WorkRestEvent =>
  kind === 'work' ? { start: '', end: '', kind } : { start: '', end: '', kind, restLocation: 'stationary_out_of_vehicle' };

interface Plan {
  work: number;
  rest?: number;
  thenWork?: number;
}

/**
 * Forecast assuming the driver keeps working from `now`.
 *
 * For every limit of the current scheme, the minutes of continued work before that limit is breached are
 * found by evaluating hypothetical futures (continue working for t minutes, then rest), so the forecast
 * uses exactly the same counting rules as evaluate(). Pure: `now` is an argument; there are no clock reads.
 */
export function forecast(events: readonly WorkRestEvent[], ctx: EvaluationContext, now: string): Forecast {
  const empty = (status: Forecast['status'], errors?: string[]): Forecast => ({
    status,
    rulesetVersion: RULESET_VERSION,
    now,
    limits: [],
    earliest: null,
    minutesToEarliest: null,
    minimumRestToClear: null,
    earliestRestart: null,
    ...(errors ? { errors } : {}),
  });
  const nowMin = parseInstant(now);
  if (nowMin === null) return empty('invalid_input', ['now is not a valid ISO 8601 instant']);
  const p = prepare(events, ctx);
  if (!p.ok) {
    const st = p.result.status;
    return empty(st.kind, st.kind === 'invalid_input' ? st.errors : st.kind === 'unsupported_jurisdiction' ? [st.message] : undefined);
  }

  // History up to `now`; the current state is assumed to continue until `now` if the record ends earlier.
  const history: ParsedEvent[] = [];
  for (const e of p.value.events) {
    if (e.start >= nowMin) break;
    history.push({ ...e, end: Math.min(e.end, nowMin) });
  }
  const last = history[history.length - 1];
  if (last && last.end < nowMin) history[history.length - 1] = { ...last, end: nowMin };

  const current = p.value.epochs[p.value.epochs.length - 1]?.scheme ?? ctx.scheme;
  const tail = Math.max(...p.value.epochs.map((e) => maxPeriod(e.scheme))) + 60;
  const unit = ctx.recordingMode === 'written' ? 15 : 1;

  const cache = new Map<string, Breach[]>();
  const run = (plan: Plan, only?: ReadonlySet<string>): Breach[] => {
    const k = `${plan.work}|${plan.rest ?? ''}|${plan.thenWork ?? ''}|${only ? [...only].join(',') : '*'}`;
    const hit = cache.get(k);
    if (hit) return hit;
    const ev: ParsedEvent[] = [...history];
    let t = nowMin;
    const push = (state: ParsedEvent['state'], minutes: number): void => {
      if (minutes <= 0) return;
      ev.push({ start: t, end: t + minutes, state, source: syntheticSource(state === WORK ? 'work' : 'rest') });
      t += minutes;
    };
    push(WORK, plan.work);
    if (plan.rest !== undefined) {
      push(REST_STATIONARY, plan.rest);
      push(WORK, plan.thenWork ?? 0);
    }
    push(REST_STATIONARY, tail);
    const input: PreparedInput = { events: mergeAdjacent(ev), epochs: p.value.epochs };
    const res = evaluatePrepared(input, ctx, only ? { onlyRules: only } : {}).breaches;
    cache.set(k, res);
    return res;
  };

  // Baseline: stop working now and rest. Breaches already unavoidable now have their window open past now.
  const baseline = run({ work: 0 });
  const baseKeys = new Set(baseline.map(keyOf));
  // A baseline breach in a window still open at `now` means the limit is already unavoidable - but only
  // where a single rest starting now could have satisfied the requirement. Requirements needing several
  // distinct rests or night rest breaks cannot be judged from the single-rest baseline, so those windows
  // are only excluded from the comparison (no claim is made about them).
  const singleRestSatisfiable = (b: Breach): boolean => {
    if (b.kind !== 'min_rest') return b.kind !== 'scheme_switch';
    const req = current.rules.find((r) => r.id === b.ruleId)?.minRest?.find((q) => q.id === b.requirementId);
    return !!req && !req.nightRest && !req.exclusiveGroup && (req.count ?? 1) === 1 && req.afterMaxWork === undefined;
  };
  const alreadyBinding = new Set(baseline.filter((b) => (parseInstant(b.windowEnd) ?? 0) > nowMin && singleRestSatisfiable(b)).map(limitKey));

  const limits: LimitForecast[] = [];
  for (const rule of current.rules) {
    const only = new Set([rule.id]);
    const targets: Array<Pick<Breach, 'ruleId' | 'kind' | 'requirementId'>> = [];
    if (rule.maxWork) targets.push({ ruleId: rule.id, kind: rule.maxWork.measure === 'long_night' ? 'max_long_night' : 'max_work' });
    for (const r of rule.minRest ?? []) targets.push({ ruleId: rule.id, kind: 'min_rest', requirementId: r.id });
    for (const target of targets) {
      const tk = limitKey(target);
      const lf: LimitForecast = {
        schemeId: current.id,
        ruleId: rule.id,
        kind: target.kind as LimitForecast['kind'],
        period: rule.period,
        minutesUntilBreach: 0,
        ...(target.requirementId ? { requirementId: target.requirementId } : {}),
      };
      if (alreadyBinding.has(tk)) {
        limits.push(lf);
        continue;
      }
      const breachesAt = (t: number): boolean => run({ work: t }, only).some((b) => limitKey(b) === tk && !baseKeys.has(keyOf(b)));
      if (!breachesAt(rule.period)) continue; // does not bind within its own period
      let lo = 0; // no breach
      let hi = rule.period; // breach
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (breachesAt(mid)) hi = mid;
        else lo = mid;
      }
      lf.minutesUntilBreach = lo;
      limits.push(lf);
    }
  }
  limits.sort((a, b) => a.minutesUntilBreach - b.minutesUntilBreach || a.period - b.period);
  const earliest = limits[0] ?? null;
  if (!earliest) return { ...empty('ok'), limits };

  // Minimum rest, taken when the earliest limit is reached, after which work can resume without a new breach.
  const tStar = earliest.minutesUntilBreach;
  const stopKeys = new Set(run({ work: tStar }).map(keyOf));
  const canResume = (rest: number): boolean =>
    !run({ work: tStar, rest, thenWork: unit }).some((b) => singleRestSatisfiable(b) && !stopKeys.has(keyOf(b)));
  let minimumRestToClear: number | null = null;
  for (let r = 15; r <= MAX_REST_SEARCH; r += 15) {
    if (canResume(r)) {
      minimumRestToClear = r;
      if (unit === 1) {
        for (let q = r - 14; q < r; q++) {
          if (canResume(q)) {
            minimumRestToClear = q;
            break;
          }
        }
      }
      break;
    }
  }
  return {
    status: 'ok',
    rulesetVersion: RULESET_VERSION,
    now,
    limits,
    earliest,
    minutesToEarliest: tStar,
    minimumRestToClear,
    earliestRestart: minimumRestToClear === null ? null : formatInstant(nowMin + tStar + minimumRestToClear),
  };
}

function maxPeriod(s: SchemeDefinition): number {
  return s.rules.reduce((m, r) => Math.max(m, r.period), 0);
}

function mergeAdjacent(ev: ParsedEvent[]): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const e of ev) {
    const prev = out[out.length - 1];
    if (prev && prev.state === e.state && prev.end === e.start) out[out.length - 1] = { ...prev, end: e.end };
    else out.push(e);
  }
  return out;
}
