/**
 * Time helpers. Pure: no clock reads. Uses the built-in Intl time-zone database
 * (an ECMAScript built-in, not a dependency) to convert between UTC instants and
 * wall-clock time in the driver's base time zone.
 *
 * Internally the engine works in integer "epoch minutes" (minutes since 1970-01-01T00:00Z).
 */

export const MINUTE_MS = 60_000;

/** Parse an ISO 8601 instant to epoch minutes (floored to the whole minute). Returns null if invalid. */
export function parseInstant(iso: string): number | null {
  if (typeof iso !== 'string') return null;
  // Require an explicit zone designator so that instants are unambiguous.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / MINUTE_MS);
}

export function formatInstant(epochMinutes: number): string {
  return new Date(epochMinutes * MINUTE_MS).toISOString();
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** True if `timeZone` is a valid IANA zone known to the runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock time in `timeZone` for the given epoch minute. */
export function toLocal(timeZone: string, epochMinutes: number): LocalDateTime {
  const parts = formatter(timeZone).formatToParts(new Date(epochMinutes * MINUTE_MS));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** UTC offset (minutes) of `timeZone` at the given instant. */
export function offsetAt(timeZone: string, epochMinutes: number): number {
  const l = toLocal(timeZone, epochMinutes);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute) / MINUTE_MS;
  return asUtc - epochMinutes;
}

/** Day number (days since 1970-01-01) of a local calendar date. */
export function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * Epoch minute of local wall-clock time `minuteOfDay` on local day `dayNum` in `timeZone`.
 * Australian DST transitions happen at 02:00/03:00, so the wall times used by the rules
 * (00:00, 06:00, 08:00, 22:00) are never skipped or repeated.
 */
export function localToEpoch(timeZone: string, dayNum: number, minuteOfDay: number): number {
  const wall = dayNum * 1440 + minuteOfDay; // wall-clock minutes treated as if UTC
  let guess = wall - offsetAt(timeZone, wall);
  guess = wall - offsetAt(timeZone, guess);
  return guess;
}

/** Local day number containing the given instant. */
export function localDayOf(timeZone: string, epochMinutes: number): number {
  const l = toLocal(timeZone, epochMinutes);
  return dayNumber(l.year, l.month, l.day);
}
