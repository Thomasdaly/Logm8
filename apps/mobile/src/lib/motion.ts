import type { DriverState, GeoFix } from './types';

export interface LocationSample {
  /** UTC ms of the fix. */
  t: number;
  /** Speed in km/h, or null if the device could not report one. */
  speedKmh: number | null;
  fix: GeoFix | null;
}

export interface MotionConfig {
  /** Moving above this speed (km/h). */
  movingKmh: number;
  /** Stopped below this speed (km/h). */
  stoppedKmh: number;
  /** Must keep moving this long before suggesting "start work". */
  movingSustainMs: number;
  /** Must stay stopped this long before suggesting "start rest" (15 min = the shortest rest that counts). */
  stoppedSustainMs: number;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  movingKmh: 10,
  stoppedKmh: 3,
  movingSustainMs: 30_000,
  stoppedSustainMs: 15 * 60_000,
};

export interface Suggestion {
  kind: 'start_work' | 'start_rest';
  /** When the condition began (UTC ms): the suggested effective time of the change. */
  since: number;
  message: string;
}

/** GPS speed is m/s, with null or negative meaning "unknown". */
export function speedToKmh(metersPerSecond: number | null | undefined): number | null {
  if (metersPerSecond === null || metersPerSecond === undefined || Number.isNaN(metersPerSecond) || metersPerSecond < 0) return null;
  return metersPerSecond * 3.6;
}

/**
 * Motion detection only SUGGESTS. This class never writes anything: it returns a Suggestion that the
 * driver must confirm in the UI (DriverController.confirmSuggestion). Dismissed suggestions are not repeated
 * for the same movement/stop.
 */
export class MotionSuggester {
  private movingSince: number | null = null;
  private stoppedSince: number | null = null;
  private dismissed = new Set<string>();
  private current: Suggestion | null = null;

  constructor(private readonly cfg: MotionConfig = DEFAULT_MOTION_CONFIG) {}

  get suggestion(): Suggestion | null {
    return this.current;
  }

  /** Feed a sample together with the driver's current logged state. Returns the active suggestion (if any). */
  update(sample: LocationSample, state: DriverState | null): Suggestion | null {
    const v = sample.speedKmh;
    if (v !== null) {
      this.movingSince = v > this.cfg.movingKmh ? (this.movingSince ?? sample.t) : null;
      this.stoppedSince = v < this.cfg.stoppedKmh ? (this.stoppedSince ?? sample.t) : null;
    }
    // A suggestion that no longer makes sense is withdrawn.
    if (this.current?.kind === 'start_work' && state === 'work') this.current = null;
    if (this.current?.kind === 'start_rest' && (state === 'rest' || this.movingSince !== null)) this.current = null;

    if (!this.current) {
      if (state !== 'work' && this.movingSince !== null && sample.t - this.movingSince >= this.cfg.movingSustainMs) {
        this.propose({ kind: 'start_work', since: this.movingSince, message: 'Vehicle movement detected. Start work?' });
      } else if (state === 'work' && this.stoppedSince !== null && sample.t - this.stoppedSince >= this.cfg.stoppedSustainMs) {
        this.propose({ kind: 'start_rest', since: this.stoppedSince, message: 'Stopped for 15 minutes or more. Start rest?' });
      }
    }
    return this.current;
  }

  private propose(s: Suggestion): void {
    if (this.dismissed.has(`${s.kind}:${s.since}`)) return;
    this.current = s;
  }

  dismiss(): void {
    if (this.current) this.dismissed.add(`${this.current.kind}:${this.current.since}`);
    this.current = null;
  }

  /** Called after the driver confirmed (the state change itself is made by the controller). */
  clear(): void {
    this.current = null;
  }
}
