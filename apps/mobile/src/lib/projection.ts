import type { RestLocation, WorkRestEvent } from '@logm8/rules-engine';
import type { DriverState, Profile, StoredEvent } from './types';

/** A state change as it stands after applying corrections. */
export interface StateEntry {
  seq: number;
  state: DriverState;
  at: string;
  restLocation?: RestLocation;
  /** seq of the latest correction that changed this entry, if any. */
  correctedBySeq?: number;
  source: 'manual' | 'suggestion';
}

export interface ProfileVersion {
  seq: number;
  at: string;
  profile: Profile;
}

/**
 * Applies corrections to the original state changes. The log itself is never modified: the latest
 * correction for an entry wins; a voided entry disappears from the projection only.
 */
export function projectEntries(events: readonly StoredEvent[]): StateEntry[] {
  const latestCorrection = new Map<number, StoredEvent<'correction'>>();
  for (const e of events) {
    if (e.type === 'correction') latestCorrection.set((e as StoredEvent<'correction'>).payload.targetSeq, e as StoredEvent<'correction'>);
  }
  const entries: StateEntry[] = [];
  for (const e of events) {
    if (e.type !== 'state_change') continue;
    const p = (e as StoredEvent<'state_change'>).payload;
    const corr = latestCorrection.get(e.seq);
    if (corr?.payload.void) continue;
    const r = corr?.payload.replacement;
    const entry: StateEntry = { seq: e.seq, state: r?.state ?? p.state, at: r?.at ?? p.at, source: p.source };
    const loc = r ? r.restLocation : p.restLocation;
    if (loc) entry.restLocation = loc;
    if (corr) entry.correctedBySeq = corr.seq;
    entries.push(entry);
  }
  return entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
}

export function currentEntry(entries: readonly StateEntry[], now: string): StateEntry | null {
  let cur: StateEntry | null = null;
  for (const e of entries) if (e.at <= now) cur = e;
  return cur;
}

/** Contiguous work/rest intervals for the rules engine. The last one runs to `now`. */
export function toWorkRestEvents(entries: readonly StateEntry[], now: string): WorkRestEvent[] {
  const out: WorkRestEvent[] = [];
  const active = entries.filter((e) => e.at < now);
  active.forEach((e, i) => {
    const end = active[i + 1]?.at ?? now;
    if (end <= e.at) return;
    if (e.state === 'work') out.push({ start: e.at, end, kind: 'work' });
    else out.push({ start: e.at, end, kind: 'rest', restLocation: e.restLocation ?? 'stationary_out_of_vehicle' });
  });
  return out;
}

/**
 * Drops history older than `days` so evaluate/forecast stay fast. Trimming happens at the start of a rest
 * so that the record never begins part-way through a work period.
 */
export function trimHistory(events: readonly WorkRestEvent[], now: string, days = 17): WorkRestEvent[] {
  const cutoff = new Date(Date.parse(now) - days * 86_400_000).toISOString();
  let i = events.findIndex((e) => e.end >= cutoff);
  if (i <= 0) return [...events];
  while (i < events.length && events[i]?.kind !== 'rest') i++;
  return events.slice(i);
}

export function profileHistory(events: readonly StoredEvent[]): ProfileVersion[] {
  return events
    .filter((e): e is StoredEvent<'profile'> => e.type === 'profile')
    .map((e) => ({ seq: e.seq, at: e.deviceTime, profile: e.payload.profile }));
}
