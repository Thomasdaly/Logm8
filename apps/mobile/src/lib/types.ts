import type { RestLocation } from '@logm8/rules-engine';

export type DriverState = 'work' | 'rest';

/** GPS position stamped on every event (SPEC §6). */
export interface GeoFix {
  lat: number;
  lon: number;
  accuracyM: number | null;
  /** Timestamp of the GNSS fix (ISO). GPS time is the "trusted time" source while offline. */
  fixTime: string | null;
}

export type SchemeFamilyChoice = 'standard' | 'bfm';
export type BaseState = 'QLD' | 'NSW' | 'VIC' | 'SA' | 'TAS' | 'ACT';

export interface Profile {
  schemeFamily: SchemeFamilyChoice;
  twoUp: boolean;
  baseName: string;
  baseState: BaseState;
  /** IANA time zone of the base: all counting uses it. */
  baseTimeZone: string;
  rego: string;
  wwdNumber: string;
  recordingMode: 'written';
}

export interface ProfilePayload {
  profile: Profile;
}

export interface StateChangePayload {
  state: DriverState;
  /** Effective time of the change (ISO). Usually the confirmation time; a suggestion may back-date it. */
  at: string;
  restLocation?: RestLocation;
  source: 'manual' | 'suggestion';
}

export interface CorrectionPayload {
  /** seq of the state_change event this corrects. The original is never touched. */
  targetSeq: number;
  /** Mandatory reason for the correction (SPEC §6). */
  reason: string;
  /** true = the original entry is withdrawn. */
  void?: boolean;
  /** Full replacement values (when not voiding). */
  replacement?: { state: DriverState; at: string; restLocation?: RestLocation };
}

export type EventPayloadMap = {
  profile: ProfilePayload;
  state_change: StateChangePayload;
  correction: CorrectionPayload;
};

export type EventType = keyof EventPayloadMap;

export interface NewEvent<T extends EventType = EventType> {
  type: T;
  payload: EventPayloadMap[T];
  /** Device clock at the time of recording (ISO). */
  deviceTime: string;
  /** Network-trusted time where available, else null (offline-first: normally null in stage 2). */
  networkTime: string | null;
  position: GeoFix | null;
  appVersion: string;
}

export type StoredEvent<T extends EventType = EventType> = NewEvent<T> & {
  seq: number;
  prevHash: string;
  hash: string;
};

export type VerifyResult = { ok: true; count: number; headHash: string } | { ok: false; count: number; brokenAtSeq: number; reason: string };
