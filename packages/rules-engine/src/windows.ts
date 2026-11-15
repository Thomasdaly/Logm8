import type { MajorRestSpec, RuleDefinition } from '@logm8/shared';
import { type Interval, type Timeline, clipRuns, len, nightRestDays } from './timeline.js';

function blockQualifies(tl: Timeline, block: Interval, spec: MajorRestSpec): boolean {
  if (spec.nightRest) return nightRestDays(tl, block.start, block.end).size > 0;
  const runs = spec.stationary ? clipRuns(tl.stationaryRuns, block.start, block.end) : [block];
  let ok = runs.some((r) => len(r) >= spec.minContinuous);
  if (!ok && spec.allowSleeperMoving) {
    ok = clipRuns(tl.sleeperMovingRuns, block.start, block.end).some((r) => len(r) >= spec.minContinuous);
  }
  if (!ok || !spec.splitRestOnly) return ok;
  // Long part of a split rest: another >= 2 h stationary block within 24 h before or after.
  const longPart = runs.find((r) => len(r) >= spec.minContinuous);
  if (!longPart) return false;
  return tl.stationaryRuns.some(
    (r) => len(r) >= 120 && (r.end <= block.start || r.start >= block.end) && r.start >= longPart.end - 1440 - 120 && r.end <= longPart.start + 1440 + 120,
  );
}

/**
 * Candidate start points for counting a rule's periods (HVNL s247).
 *
 * - Periods counted from any rest: the end of every rest break.
 * - Periods counted from a relevant major rest: the end of every qualifying major rest break; and, where
 *   no relevant major rest break has been taken in the preceding period ("If you have not taken the
 *   required rest break, count from the end of any rest break" - NHVR Counting time), the end of any rest.
 * - The start of the record is treated as the end of a rest when the record starts with work.
 *
 * Every start produces its own window; later rests never reset an unfinished window, so overlapping
 * windows are all checked.
 */
export function windowStarts(tl: Timeline, rule: RuleDefinition): number[] {
  const starts = new Set<number>();
  const recordStartIsStart = !tl.firstIsRest && tl.states.length > 0;
  if (recordStartIsStart) starts.add(tl.t0);
  const restEnds = tl.restBlocks.map((b) => b.end);

  if (rule.countFrom === 'any_rest' || !rule.majorRest || rule.majorRest.length === 0) {
    for (const e of restEnds) starts.add(e);
  } else {
    const specs = rule.majorRest;
    const qualifying = tl.restBlocks.filter((b) => specs.some((s) => blockQualifies(tl, b, s))).map((b) => b.end);
    for (const q of qualifying) starts.add(q);
    const anchors = recordStartIsStart ? [tl.t0, ...qualifying] : qualifying;
    for (const e of restEnds) {
      const covered = anchors.some((q) => q < e && q >= e - rule.period);
      if (!covered) starts.add(e);
    }
  }
  return [...starts].filter((s) => s < tl.end).sort((a, b) => a - b);
}
