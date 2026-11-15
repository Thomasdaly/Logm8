import type {
  Breach,
  EvaluationContext,
  EvaluationResult,
  Notice,
  RuleDefinition,
  SchemeDefinition,
  WorkRestEvent,
  WorkSeverityTier,
  RiskCategory,
} from '@logmate/shared';
import { checkJurisdiction } from './jurisdiction.js';
import { longNightIn, longNightMask } from './longNight.js';
import { checkRest } from './requirements.js';
import { validateScheme } from './schemeValidation.js';
import { formatInstant, isValidTimeZone, parseInstant } from './time.js';
import { type ParsedEvent, type Timeline, buildTimeline, len, parseEvents, workIn } from './timeline.js';
import { windowStarts } from './windows.js';

/** Version of the rule-set / engine logic. Stored on every evaluation result (SPEC §6). */
export const RULESET_VERSION = '1.0.0+nhvr-2026-11-15';

function workTier(tiers: WorkSeverityTier[] | undefined, actual: number): RiskCategory | undefined {
  if (!tiers) return undefined;
  for (const t of tiers) if (t.maxActual === undefined || actual <= t.maxActual) return t.category;
  return undefined;
}

function fmtH(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export interface EvaluateOptions {
  /** Restrict to these rule ids (used by forecast). */
  onlyRules?: ReadonlySet<string>;
}

interface Epoch {
  scheme: SchemeDefinition;
  from: number; // epoch minute the scheme starts applying
  until: number; // exclusive
  /** Minute from which history counts for this scheme (end of reset rest, or record start). */
  historyFrom: number;
}

/** Evaluate one scheme over a timeline. Breaches are reported for windows that touch [from, until). */
function evaluateScheme(
  tl: Timeline,
  scheme: SchemeDefinition,
  from: number,
  until: number,
  opts: EvaluateOptions,
  notices: Notice[],
): Breach[] {
  const breaches: Breach[] = [];
  const dailyRule = scheme.longNight ? scheme.rules.find((r) => r.id === scheme.longNight?.dailyPeriodRuleId) : undefined;
  const lnMask = scheme.longNight && dailyRule ? longNightMask(tl, scheme.longNight, dailyRule) : undefined;

  for (const rule of scheme.rules) {
    if (opts.onlyRules && !opts.onlyRules.has(rule.id)) continue;
    for (const s of windowStarts(tl, rule)) {
      const e = s + rule.period;
      if (e <= from || s >= until) continue;
      const base = { schemeId: scheme.id, ruleId: rule.id, period: rule.period, windowStart: formatInstant(s), windowEnd: formatInstant(e) };
      breaches.push(...checkMaxWork(tl, scheme, rule, s, e, base, lnMask));
      if (rule.minRest && rule.minRest.length > 0 && e <= tl.end) {
        const rc = checkRest(tl, rule.minRest, s, e);
        if (rc.splitRestDefenceUsed) {
          notices.push({
            code: 'bfm_split_rest_defence',
            at: base.windowStart,
            message: `${rule.id}: no 7 continuous hours stationary rest in the 24 h period from ${base.windowStart}; a 6 h + 2 h split rest was taken. This is only a legal defence (HVNL s255) if the split rest was not scheduled.`,
          });
        }
        for (const f of rc.failures) {
          const b: Breach = {
            ...base,
            requirementId: f.requirement.id,
            kind: 'min_rest',
            actual: f.actual,
            limit: f.limit,
            unit: f.unit,
            message: `${rule.description}: requirement "${f.requirement.description}" not met (${f.unit === 'count' ? `${f.actual} of ${f.limit}` : `best ${fmtH(f.actual)} vs ${fmtH(f.limit)}`})${f.note ? `; ${f.note}` : ''}.`,
          };
          if (f.severity) b.severity = f.severity;
          breaches.push(b);
        }
      }
    }
  }
  return breaches;
}

function checkMaxWork(
  tl: Timeline,
  scheme: SchemeDefinition,
  rule: RuleDefinition,
  s: number,
  e: number,
  base: Pick<Breach, 'schemeId' | 'ruleId' | 'period' | 'windowStart' | 'windowEnd'>,
  lnMask: Uint8Array | undefined,
): Breach[] {
  const mw = rule.maxWork;
  if (!mw) return [];
  let actual: number;
  if (mw.measure === 'long_night') {
    if (!lnMask || !scheme.longNight) return [];
    actual = longNightIn(tl, lnMask, scheme.longNight, s, e).minutes;
  } else {
    actual = workIn(tl, s, e);
  }
  if (actual <= mw.minutes) return [];
  const b: Breach = {
    ...base,
    kind: mw.measure === 'long_night' ? 'max_long_night' : 'max_work',
    actual,
    limit: mw.minutes,
    unit: 'minutes',
    message: `${rule.description}: ${fmtH(actual)} ${mw.measure === 'long_night' ? 'long/night work' : 'work'} exceeds ${fmtH(mw.minutes)}.`,
  };
  const sev = workTier(mw.tiers, actual);
  if (sev) b.severity = sev;
  return [b];
}

function maxPeriod(s: SchemeDefinition): number {
  return s.rules.reduce((m, r) => Math.max(m, r.period), 0);
}

export interface PreparedInput {
  events: ParsedEvent[];
  epochs: Epoch[];
}

export type PrepareResult = { ok: true; value: PreparedInput } | { ok: false; result: EvaluationResult };

export function prepare(events: readonly WorkRestEvent[], ctx: EvaluationContext): PrepareResult {
  const errors: string[] = [];
  if (!ctx || typeof ctx !== 'object') return invalid(['context is required']);
  if (!Array.isArray(events)) return invalid(['events must be an array']);
  if (!isValidTimeZone(ctx.baseTimeZone)) errors.push(`baseTimeZone is not a valid IANA time zone: ${String(ctx.baseTimeZone)}`);
  if (ctx.recordingMode !== 'written' && ctx.recordingMode !== 'electronic') errors.push(`recordingMode must be 'written' or 'electronic'`);
  const schemes = [ctx.scheme, ...(ctx.schemeChanges ?? []).map((c) => c.scheme)];
  schemes.forEach((s, i) => {
    const v = validateScheme(s);
    if (!v.ok) errors.push(...v.errors.map((e) => `scheme[${i}]: ${e}`));
  });
  if (errors.length > 0) return invalid(errors);

  const juris = checkJurisdiction(ctx.baseTimeZone, events);
  if (!juris.supported) {
    return {
      ok: false,
      result: {
        breaches: [],
        status: { kind: 'unsupported_jurisdiction', rulesetVersion: RULESET_VERSION, jurisdiction: juris.jurisdiction, message: juris.message },
      },
    };
  }
  const parsed = parseEvents(events);
  if (!parsed.ok) return invalid(parsed.errors);

  const changes = (ctx.schemeChanges ?? []).map((c, i) => ({ at: parseInstant(c.at), scheme: c.scheme, i }));
  const bad = changes.find((c) => c.at === null);
  if (bad) return invalid([`schemeChanges[${bad.i}].at is not a valid ISO 8601 instant`]);
  for (let i = 1; i < changes.length; i++) {
    if ((changes[i]?.at ?? 0) <= (changes[i - 1]?.at ?? 0)) return invalid(['schemeChanges must be in chronological order']);
  }
  const epochs: Epoch[] = [];
  let cur: Epoch = { scheme: ctx.scheme, from: Number.MIN_SAFE_INTEGER, until: Number.MAX_SAFE_INTEGER, historyFrom: Number.MIN_SAFE_INTEGER };
  for (const c of changes) {
    const at = c.at ?? 0;
    cur.until = at;
    epochs.push(cur);
    cur = { scheme: c.scheme, from: at, until: Number.MAX_SAFE_INTEGER, historyFrom: Number.MIN_SAFE_INTEGER };
  }
  epochs.push(cur);
  return { ok: true, value: { events: parsed.events, epochs } };
}

function invalid(errors: string[]): PrepareResult {
  return { ok: false, result: { breaches: [], status: { kind: 'invalid_input', rulesetVersion: RULESET_VERSION, errors } } };
}

/** Evaluate prepared input. Exposed for forecast(). */
export function evaluatePrepared(input: PreparedInput, ctx: EvaluationContext, opts: EvaluateOptions = {}): EvaluationResult {
  const notices: Notice[] = [];
  const breaches: Breach[] = [];
  const full = buildTimeline(input.events, { mode: ctx.recordingMode, timeZone: ctx.baseTimeZone });

  for (let i = 0; i < input.epochs.length; i++) {
    const ep = input.epochs[i];
    if (!ep) continue;
    let historyFrom = Number.MIN_SAFE_INTEGER;
    if (i > 0) {
      const prev = input.epochs[i - 1];
      const sw = checkSwitch(full, prev?.scheme ?? ep.scheme, ep, ctx, notices);
      breaches.push(...sw.breaches);
      historyFrom = sw.historyFrom;
    }
    if (ep.from >= full.end || ep.until <= full.t0) continue;
    const tl =
      historyFrom > full.t0 || ep.until < full.end
        ? buildTimeline(input.events, {
            mode: ctx.recordingMode,
            timeZone: ctx.baseTimeZone,
            ...(historyFrom > full.t0 ? { from: historyFrom } : {}),
            ...(ep.until < full.end ? { until: ep.until } : {}),
          })
        : full;
    breaches.push(...evaluateScheme(tl, ep.scheme, Math.max(ep.from, historyFrom), ep.until, opts, notices));
  }

  if (full.unknownRestLocation) {
    notices.push({ code: 'rest_location_unknown', message: 'Some rest has no location; it was treated as NOT stationary rest.' });
  }
  for (const g of full.gaps) {
    notices.push({ code: 'data_gap', at: formatInstant(g.start), message: `No record from ${formatInstant(g.start)} to ${formatInstant(g.end)}; that time is counted as neither work nor rest.` });
  }
  if (full.states.length > 0 && !full.firstIsRest) {
    notices.push({ code: 'record_start_assumed_after_rest', at: formatInstant(full.t0), message: 'The record starts with work; periods are also counted from the start of the record.' });
  }

  const unique = dedupe(breaches);
  return {
    breaches: unique,
    status: {
      kind: unique.length > 0 ? 'breach' : 'compliant',
      rulesetVersion: RULESET_VERSION,
      schemeId: input.epochs[input.epochs.length - 1]?.scheme.id ?? ctx.scheme.id,
      evaluatedFrom: full.states.length > 0 ? formatInstant(full.t0) : null,
      evaluatedTo: full.states.length > 0 ? formatInstant(full.end) : null,
      notices,
    },
  };
}

function dedupe(breaches: Breach[]): Breach[] {
  const seen = new Set<string>();
  return breaches.filter((b) => {
    const k = `${b.schemeId}|${b.ruleId}|${b.requirementId ?? ''}|${b.kind}|${b.windowStart}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Changing work and rest hours option (HVNL s262-263). The driver may only drive under the new option if
 * they have had a reset rest break (>= 48 continuous hours), or, when changing from standard hours (or BFM
 * hours, pre-1 Aug 2026 s263), they comply with all maximum work and minimum rest requirements of the new option.
 * After a reset rest break the new option is counted from the end of the reset rest break (s263(2)).
 */
function checkSwitch(
  full: Timeline,
  from: SchemeDefinition,
  ep: Epoch,
  ctx: EvaluationContext,
  notices: Notice[],
): { breaches: Breach[]; historyFrom: number } {
  const at = ep.from;
  // The rest break the change happens in (or that ends exactly at the change).
  const block = full.restBlocks.find((b) => b.start <= at && b.end >= at);
  const reset = block !== undefined && len(block) >= from.resetRestMinutes;
  if (reset) {
    notices.push({ code: 'reset_rest_taken', at: formatInstant(block.end), message: `Reset rest break of ${fmtH(len(block))} taken; ${ep.scheme.name} is counted from ${formatInstant(block.end)}.` });
    return { breaches: [], historyFrom: block.end };
  }
  const base = {
    schemeId: ep.scheme.id,
    ruleId: 'scheme-switch',
    period: from.resetRestMinutes,
    windowStart: formatInstant(at - from.resetRestMinutes),
    windowEnd: formatInstant(at),
    limit: from.resetRestMinutes,
    unit: 'minutes' as const,
    kind: 'scheme_switch' as const,
  };
  const longestRestBefore = block ? len(block) : 0;
  if (from.switchingOut === 'reset_only') {
    return {
      breaches: [{ ...base, actual: longestRestBefore, message: `Changing from ${from.name} to ${ep.scheme.name} requires a reset rest break of ${fmtH(from.resetRestMinutes)}.` }],
      historyFrom: Number.MIN_SAFE_INTEGER,
    };
  }
  // Compliance with the new option over the history before the change.
  const lookback = maxPeriod(ep.scheme);
  const hist = buildTimeline(
    full.states.length > 0 ? reconstructEvents(full) : [],
    { mode: ctx.recordingMode, timeZone: ctx.baseTimeZone, from: at - lookback * 2, until: at },
  );
  const prior = evaluateScheme(hist, ep.scheme, at - lookback, at, {}, []);
  if (prior.length === 0) return { breaches: [], historyFrom: Number.MIN_SAFE_INTEGER };
  return {
    breaches: [
      {
        ...base,
        actual: longestRestBefore,
        message: `Changed from ${from.name} to ${ep.scheme.name} without a ${fmtH(from.resetRestMinutes)} reset rest break while not complying with ${ep.scheme.name} (${prior.length} breach(es) of the new option's limits before the change, e.g. ${prior[0]?.ruleId}).`,
      },
    ],
    historyFrom: Number.MIN_SAFE_INTEGER,
  };
}

/** Rebuild parsed events from a counted timeline (states are already counted, so rounding is idempotent). */
function reconstructEvents(tl: Timeline): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  let i = 0;
  while (i < tl.states.length) {
    const s = tl.states[i] ?? 0;
    let j = i;
    while (j < tl.states.length && tl.states[j] === s) j++;
    if (s !== 0) {
      out.push({
        start: tl.t0 + i,
        end: tl.t0 + j,
        state: s as ParsedEvent['state'],
        source: { start: '', end: '', kind: s === 1 ? 'work' : 'rest', restLocation: 'stationary_out_of_vehicle' },
      });
    }
    i = j;
  }
  return out;
}

/**
 * Evaluate a work/rest record against the scheme(s) in `ctx`.
 * Pure and deterministic: no clock reads, no I/O.
 */
export function evaluate(events: readonly WorkRestEvent[], ctx: EvaluationContext): EvaluationResult {
  const p = prepare(events, ctx);
  if (!p.ok) return p.result;
  return evaluatePrepared(p.value, ctx);
}
