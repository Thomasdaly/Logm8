import type { RestRequirement, RestSeverityTier, RiskCategory } from '@logm8/shared';
import { type Interval, type Timeline, clipRuns, len, nightRestDays, workIn } from './timeline.js';

/** Minimum length of rest that counts towards a minimum rest requirement (Fatigue Reg s19(4)-(5), s19A(4)). */
export const MIN_COUNTED_REST = 15;

export interface RestFailure {
  requirement: RestRequirement;
  actual: number;
  limit: number;
  unit: 'minutes' | 'count';
  severity?: RiskCategory;
  note?: string;
}

export interface RestCheck {
  failures: RestFailure[];
  splitRestDefenceUsed: boolean;
}

function candidateRuns(tl: Timeline, req: RestRequirement, a: number, b: number): Interval[] {
  // Continuous requirements keep every countable block so the best (longest) one can be reported for the
  // severity tier; satisfy() then requires `total`. Block-total requirements only count blocks >= minBlock.
  const minBlock = req.continuous ? MIN_COUNTED_REST : Math.max(req.minBlock, MIN_COUNTED_REST);
  const base = req.stationary ? clipRuns(tl.stationaryRuns, a, b) : clipRuns(tl.restBlocks, a, b);
  const extra = req.allowSleeperMoving ? clipRuns(tl.sleeperMovingRuns, a, b) : [];
  const runs = [...base, ...extra].filter((r) => len(r) >= minBlock);
  if (req.afterMaxWork !== undefined) {
    const max = req.afterMaxWork;
    return runs.filter((r) => workIn(tl, a, r.start) <= max);
  }
  return runs;
}

function overlaps(x: Interval, y: Interval): boolean {
  return x.start < y.end && y.start < x.end;
}

/** The parts of `runs` that are not covered by `used` (minutes already counted towards another requirement). */
function freeParts(runs: Interval[], used: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const r of runs) {
    let pieces: Interval[] = [r];
    for (const u of used) {
      pieces = pieces.flatMap((p) =>
        overlaps(p, u)
          ? [
              { start: p.start, end: Math.min(p.end, u.start) },
              { start: Math.max(p.start, u.end), end: p.end },
            ].filter((x) => x.end > x.start)
          : [p],
      );
    }
    out.push(...pieces);
  }
  return out;
}

/**
 * Try to satisfy a requirement from rest that has not already been counted towards another requirement in the
 * same exclusive group. The same *minutes* of rest cannot count twice (Fatigue Reg s22(3)), but one long rest can
 * serve both, e.g. a 48 h rest is a 24 continuous hour rest plus 24 further hours. Returns the minutes consumed.
 */
function satisfy(req: RestRequirement, runs: Interval[], used: Interval[]): Interval[] | null {
  const free = freeParts(runs, used);
  if (req.continuous) {
    const ok = free.filter((r) => len(r) >= req.total).sort((x, y) => len(x) - len(y));
    const need = req.count ?? 1;
    return ok.length >= need ? ok.slice(0, need).map((r) => ({ start: r.start, end: r.start + req.total })) : null;
  }
  const usable = free.filter((r) => len(r) >= Math.max(req.minBlock, MIN_COUNTED_REST));
  let remaining = req.total;
  const take: Interval[] = [];
  for (const r of usable) {
    if (remaining <= 0) break;
    const n = Math.min(len(r), remaining);
    take.push({ start: r.start, end: r.start + n });
    remaining -= n;
  }
  return remaining <= 0 ? take : null;
}

function measure(req: RestRequirement, runs: Interval[]): number {
  if (req.continuous) return runs.reduce((m, r) => Math.max(m, len(r)), 0);
  return runs.reduce((sum, r) => sum + len(r), 0);
}

function restTier(tiers: RestSeverityTier[] | undefined, actual: number): RiskCategory | undefined {
  if (!tiers) return undefined;
  for (const t of tiers) if (t.minActual === undefined || actual >= t.minActual) return t.category;
  return undefined;
}

function longestConsecutiveRun(days: Set<number>): number {
  let best = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue;
    let n = 1;
    while (days.has(d + n)) n++;
    best = Math.max(best, n);
  }
  return best;
}

function checkNightGroup(reqs: RestRequirement[], days: Set<number>): RestFailure[] {
  const failures: RestFailure[] = [];
  const longest = longestConsecutiveRun(days);
  for (const r of reqs) {
    const need = r.count ?? 1;
    if (r.consecutive ? longest < need : days.size < need) {
      failures.push({ requirement: r, actual: r.consecutive ? longest : days.size, limit: need, unit: 'count' });
    }
  }
  if (failures.length === 0) {
    // Non-concurrency (Fatigue Reg s22(3)(a)): the night rest breaks must be distinct.
    const total = reqs.reduce((s, r) => s + (r.count ?? 1), 0);
    const last = reqs[reqs.length - 1];
    if (days.size < total && last) {
      failures.push({
        requirement: last,
        actual: Math.max(0, days.size - (total - (last.count ?? 1))),
        limit: last.count ?? 1,
        unit: 'count',
        note: 'night rest breaks cannot be counted towards more than one requirement',
      });
    }
  }
  return failures;
}

/** Was a split rest relied on in [a, b)? (no 7 h block, but a 6 h + 2 h pair). */
function splitRestIn(tl: Timeline, a: number, b: number, blocks: number[]): boolean {
  const runs = clipRuns(tl.stationaryRuns, a, b);
  if (runs.some((r) => len(r) >= 420)) return false;
  return hasSplitPair(runs, blocks);
}

function hasSplitPair(runs: Interval[], blocks: number[]): boolean {
  const [longB = 360, shortB = 120] = blocks;
  return runs.some((x) => len(x) >= longB && runs.some((y) => y !== x && len(y) >= shortB));
}

/** Check all minimum-rest requirements of a rule for window [a, b). The window must be complete. */
export function checkRest(tl: Timeline, reqs: readonly RestRequirement[], a: number, b: number): RestCheck {
  const failures: RestFailure[] = [];
  let splitRestDefenceUsed = false;

  const groups = new Map<string, RestRequirement[]>();
  const nightReqs = new Map<string, RestRequirement[]>();
  for (const r of reqs) {
    const key = r.exclusiveGroup ?? `__${r.id}`;
    const target = r.nightRest ? nightReqs : groups;
    target.set(key, [...(target.get(key) ?? []), r]);
  }

  if (nightReqs.size > 0) {
    const days = nightRestDays(tl, a, b);
    for (const g of nightReqs.values()) failures.push(...checkNightGroup(g, days));
  }

  for (const group of groups.values()) {
    const used: Interval[] = [];
    // Requirements with an extra condition first, so that they get first pick of the rest blocks.
    const ordered = [...group].sort((x, y) => Number(y.afterMaxWork !== undefined) - Number(x.afterMaxWork !== undefined));
    for (const req of ordered) {
      const runs = candidateRuns(tl, req, a, b);
      const got = satisfy(req, runs, used);
      if (got) {
        used.push(...got);
        continue;
      }
      if (req.splitRestDefence && hasSplitPair(clipRuns(tl.stationaryRuns, a, b), req.splitRestDefence.blocks)) {
        // HVNL s255 (BFM solo): defence if 6 h + 2 h stationary rest in the period and no split rest
        // in the previous 24 hours.
        if (!splitRestIn(tl, a - 1440, a, req.splitRestDefence.blocks)) {
          splitRestDefenceUsed = true;
          continue;
        }
      }
      const free = freeParts(runs, used).filter((r) => req.continuous || len(r) >= Math.max(req.minBlock, MIN_COUNTED_REST));
      const actual = measure(req, free);
      const sharedOnly = measure(req, runs) >= req.total && (req.count ?? 1) === 1;
      const failure: RestFailure = {
        requirement: req,
        actual,
        limit: req.total,
        unit: 'minutes',
      };
      const sev = restTier(req.tiers, actual);
      if (sev) failure.severity = sev;
      if (sharedOnly) failure.note = 'the only qualifying rest was already counted towards another requirement';
      failures.push(failure);
    }
  }
  return { failures, splitRestDefenceUsed };
}
