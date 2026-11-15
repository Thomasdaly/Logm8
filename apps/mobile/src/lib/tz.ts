/** Small time-zone helpers (Intl). All counting in the app is in the driver's base time zone. */

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = cache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    cache.set(timeZone, f);
  }
  return f;
}

export function localParts(timeZone: string, ms: number): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = fmt(timeZone).formatToParts(new Date(ms));
  const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
}

export function offsetMinutes(timeZone: string, ms: number): number {
  const p = localParts(timeZone, ms);
  return (Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000) / 60_000;
}

/** UTC ms of local midnight at the start of local day `dayOffset` relative to the day containing `ms`. */
export function localMidnight(timeZone: string, ms: number, dayOffset = 0): number {
  const p = localParts(timeZone, ms);
  const wall = Date.UTC(p.y, p.mo - 1, p.d + dayOffset, 0, 0);
  let guess = wall - offsetMinutes(timeZone, wall) * 60_000;
  guess = wall - offsetMinutes(timeZone, guess) * 60_000;
  return guess;
}

export function formatLocalTime(timeZone: string, ms: number): string {
  const p = localParts(timeZone, ms);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function formatLocalDateTime(timeZone: string, ms: number): string {
  const p = localParts(timeZone, ms);
  return `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')} ${formatLocalTime(timeZone, ms)}`;
}
