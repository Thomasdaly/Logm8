import type { WorkRestEvent } from '@logm8/rules-engine';
import { localMidnight } from './tz';

export type SlotState = 'work' | 'rest' | 'none' | 'future';

export interface Slot {
  /** UTC ms at the start of the 15-minute block. */
  start: number;
  state: SlotState;
}

const SLOT_MS = 15 * 60_000;

/**
 * Today's 15-minute timeline in the base time zone, as on the written daily sheet:
 * any work in a block makes it a work block; a block is rest only if it is rest throughout.
 */
export function buildTodaySlots(events: readonly WorkRestEvent[], timeZone: string, nowMs: number): Slot[] {
  const dayStart = localMidnight(timeZone, nowMs, 0);
  const dayEnd = localMidnight(timeZone, nowMs, 1);
  const ivs = events.map((e) => ({ s: Date.parse(e.start), e: Date.parse(e.end), kind: e.kind }));
  const slots: Slot[] = [];
  for (let t = dayStart; t < dayEnd; t += SLOT_MS) {
    const end = t + SLOT_MS;
    if (t >= nowMs) {
      slots.push({ start: t, state: 'future' });
      continue;
    }
    let work = 0;
    let rest = 0;
    for (const iv of ivs) {
      const o = Math.min(iv.e, end, nowMs) - Math.max(iv.s, t);
      if (o <= 0) continue;
      if (iv.kind === 'work') work += o;
      else rest += o;
    }
    const covering = nowMs < end ? nowMs - t : SLOT_MS; // the current block is judged on what has happened so far
    const state: SlotState = work > 0 ? 'work' : rest >= covering && rest > 0 ? 'rest' : 'none';
    slots.push({ start: t, state });
  }
  return slots;
}
