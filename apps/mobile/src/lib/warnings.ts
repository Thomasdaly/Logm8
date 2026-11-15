/** Minutes before the earliest limit at which a warning fires (SPEC §5). */
export const WARNING_THRESHOLDS: readonly number[] = [60, 30, 15, 5];

export interface WarningFire {
  /** The threshold that was crossed (minutes), or 0 for "limit reached". */
  threshold: number;
  minutesRemaining: number;
  text: string;
}

export function warningText(threshold: number, limitLabel: string): string {
  if (threshold <= 0) return `Limit reached. You must rest now. ${limitLabel}`;
  return `${threshold} minutes until a required rest. ${limitLabel}`;
}

/**
 * Decides when to announce a warning. Each threshold fires once per "episode" (a work run against one
 * limit). If several thresholds are crossed at once (app was in the background), only the most urgent one is
 * announced and the larger ones are marked as done.
 */
export class WarningTracker {
  private episode: string | null = null;
  private fired = new Set<number>();

  check(episode: string, minutesRemaining: number | null, limitLabel: string): WarningFire | null {
    if (episode !== this.episode) {
      this.episode = episode;
      this.fired = new Set();
    }
    if (minutesRemaining === null) return null;
    const crossed = [...WARNING_THRESHOLDS, 0].filter((t) => minutesRemaining <= t && !this.fired.has(t));
    if (crossed.length === 0) return null;
    for (const t of crossed) this.fired.add(t);
    const threshold = Math.min(...crossed);
    return { threshold, minutesRemaining, text: warningText(threshold, limitLabel) };
  }

  reset(): void {
    this.episode = null;
    this.fired = new Set();
  }
}
