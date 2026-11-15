/**
 * Shared domain types for LogMate.
 *
 * This module is TYPES ONLY (no runtime code), so that packages depending on it
 * (notably @logmate/rules-engine) keep zero runtime dependencies.
 *
 * All durations in scheme definitions are in MINUTES.
 */

// ---------------------------------------------------------------------------
// Input events
// ---------------------------------------------------------------------------

export type RestLocation =
  | 'stationary_out_of_vehicle'
  | 'sleeper_berth_stationary'
  | 'sleeper_berth_moving'
  | 'in_vehicle_other';

/** States/territories. WA and NT are not HVNL participating jurisdictions (unsupported in v1). */
export type Jurisdiction = 'QLD' | 'NSW' | 'VIC' | 'SA' | 'TAS' | 'ACT' | 'WA' | 'NT';

export interface WorkRestEvent {
  /** ISO 8601 instant (UTC, e.g. 2026-11-16T20:00:00Z; an explicit offset is also accepted). */
  start: string;
  /** ISO 8601 instant, exclusive. */
  end: string;
  kind: 'work' | 'rest';
  /** Where the rest was taken. Missing on a rest event => treated as NOT stationary (conservative). */
  restLocation?: RestLocation;
  /** Optional descriptive sub-type of work. The engine counts ALL work equally (HVNL s221 "work"). */
  activity?: 'driving' | 'other_work';
  /** Optional jurisdiction the event took place in. WA/NT => unsupported-jurisdiction result. */
  jurisdiction?: Jurisdiction;
}

export type RecordingMode = 'written' | 'electronic';

// ---------------------------------------------------------------------------
// Scheme definitions (data, JSON-serialisable)
// ---------------------------------------------------------------------------

export type RiskCategory = 'minor' | 'substantial' | 'severe' | 'critical';

/** Tier applies if actual work (minutes) <= maxActual; the last tier has no maxActual. Ordered ascending. */
export interface WorkSeverityTier {
  category: RiskCategory;
  maxActual?: number;
}

/** Tier applies if actual rest (minutes) >= minActual; the last tier has no minActual. Ordered descending. */
export interface RestSeverityTier {
  category: RiskCategory;
  minActual?: number;
}

export interface MaxWorkLimit {
  /** Maximum minutes of the measure in the period. */
  minutes: number;
  /** 'work' = all work time; 'long_night' = BFM long/night work time (see SchemeDefinition.longNight). */
  measure: 'work' | 'long_night';
  tiers?: WorkSeverityTier[];
}

/**
 * A minimum-rest requirement for a period. Field names follow SPEC §4.3.
 *
 * - continuous=true: `count` (default 1) distinct continuous blocks, each >= `total` minutes.
 * - continuous=false: rest blocks of at least `minBlock` minutes adding up to >= `total`.
 * - nightRest=true: `count` night rest breaks (HVNL s5); with consecutive=true they must be on consecutive days.
 */
export interface RestRequirement {
  id: string;
  description: string;
  total: number;
  minBlock: number;
  continuous: boolean;
  /** Only stationary rest time counts (HVNL s221: out of vehicle, or sleeper berth of a stationary vehicle). */
  stationary: boolean;
  /** Alternatively, a continuous block of rest in an approved sleeper berth while moving satisfies it. */
  allowSleeperMoving?: boolean;
  nightRest?: boolean;
  count?: number;
  consecutive?: boolean;
  /** The block must start after no more than this many minutes of work in the period. */
  afterMaxWork?: number;
  /** Requirements with the same group cannot be fulfilled by the same rest (Fatigue Reg s22(3)). */
  exclusiveGroup?: string;
  /** BFM solo split-rest defence (HVNL s255 as in force before 1 Aug 2026). */
  splitRestDefence?: { blocks: number[] };
  tiers?: RestSeverityTier[];
}

/** A rest that qualifies as a "relevant major rest break" (start point for counting a period >= 24 h). */
export interface MajorRestSpec {
  /** Continuous rest of at least this many minutes. Ignored when nightRest=true. */
  minContinuous: number;
  stationary: boolean;
  allowSleeperMoving?: boolean;
  /** The rest must contain a night rest break. */
  nightRest?: boolean;
  /** Only counts when the block is the long part of a split rest (BFM split rest). */
  splitRestOnly?: boolean;
}

export interface RuleDefinition {
  id: string;
  description: string;
  /** Period length in minutes. */
  period: number;
  countFrom: 'any_rest' | 'relevant_major_rest';
  /** Alternatives that qualify as the relevant major rest (required when countFrom = relevant_major_rest). */
  majorRest?: MajorRestSpec[];
  maxWork?: MaxWorkLimit;
  minRest?: RestRequirement[];
  /** Official source reference(s) for this row. */
  source: string;
}

export interface LongNightDefinition {
  /** Work beyond this many minutes in a 24 h period is "long" work (720 = 12 h). */
  dailyThreshold: number;
  /** id of the rule whose 24 h periods are used for the daily threshold. */
  dailyPeriodRuleId: string;
  /** Night work window in base-tz minutes after local midnight: [nightFrom, nightTo). */
  nightFrom: number;
  nightTo: number;
  /** Long/night time is counted in blocks of this many minutes, rounded up. */
  roundUpTo: number;
}

export type SchemeFamily = 'standard' | 'bfm' | 'afm' | 'ach' | 'exemption' | 'custom';

export interface SchemeDefinition {
  schemaVersion: 1;
  id: string;
  name: string;
  family: SchemeFamily;
  arrangement: 'solo' | 'two_up';
  /** Version of this scheme's data. */
  version: string;
  /** Date (YYYY-MM-DD) the values were last verified against official sources. */
  verifiedOn: string;
  sources: string[];
  rules: RuleDefinition[];
  longNight?: LongNightDefinition;
  /** What leaving this scheme requires (HVNL s263). */
  switchingOut: 'compliance_or_reset' | 'reset_only';
  /** Reset rest break length in minutes (HVNL s263(5): 48 continuous hours). */
  resetRestMinutes: number;
}

// ---------------------------------------------------------------------------
// Evaluation context and results
// ---------------------------------------------------------------------------

export interface SchemeChange {
  /** Instant at which the driver changed to `scheme`. */
  at: string;
  scheme: SchemeDefinition;
}

export interface EvaluationContext {
  /** IANA time zone of the driver's base, e.g. Australia/Brisbane. */
  baseTimeZone: string;
  recordingMode: RecordingMode;
  /** Scheme in effect at the start of the record. */
  scheme: SchemeDefinition;
  /** Later changes of work and rest hours option, in chronological order. */
  schemeChanges?: SchemeChange[];
}

export type BreachKind = 'max_work' | 'max_long_night' | 'min_rest' | 'scheme_switch';

export interface Breach {
  schemeId: string;
  ruleId: string;
  requirementId?: string;
  kind: BreachKind;
  /** Period length in minutes. */
  period: number;
  windowStart: string;
  windowEnd: string;
  actual: number;
  limit: number;
  unit: 'minutes' | 'count';
  severity?: RiskCategory;
  message: string;
}

export type NoticeCode =
  | 'rest_location_unknown'
  | 'bfm_split_rest_defence'
  | 'data_gap'
  | 'record_start_assumed_after_rest'
  | 'reset_rest_taken';

export interface Notice {
  code: NoticeCode;
  message: string;
  at?: string;
}

export type SchemeStatus =
  | {
      kind: 'compliant' | 'breach';
      rulesetVersion: string;
      schemeId: string;
      evaluatedFrom: string | null;
      evaluatedTo: string | null;
      notices: Notice[];
    }
  | {
      kind: 'unsupported_jurisdiction';
      rulesetVersion: string;
      jurisdiction: string;
      message: string;
    }
  | {
      kind: 'invalid_input';
      rulesetVersion: string;
      errors: string[];
    };

export interface EvaluationResult {
  breaches: Breach[];
  status: SchemeStatus;
}

export interface LimitForecast {
  schemeId: string;
  ruleId: string;
  requirementId?: string;
  kind: Exclude<BreachKind, 'scheme_switch'>;
  period: number;
  /** Minutes of continued work from `now` before this limit is breached (0 = already unavoidable). */
  minutesUntilBreach: number;
}

export interface Forecast {
  status: SchemeStatus['kind'] | 'ok';
  rulesetVersion: string;
  now: string;
  /** One entry per rule/requirement that would be breached by continuous work within its period. */
  limits: LimitForecast[];
  /** The earliest binding limit, or null if nothing binds. */
  earliest: LimitForecast | null;
  minutesToEarliest: number | null;
  /**
   * Minimum continuous rest, taken when the earliest limit is reached, after which work can
   * resume without a new breach. null if not determinable within 48 h.
   */
  minimumRestToClear: number | null;
  /** Earliest instant work can resume compliantly if the driver works until the limit and then rests. */
  earliestRestart: string | null;
  errors?: string[];
}
