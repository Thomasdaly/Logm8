/** Above this speed no interactive UI is shown (SPEC §5 "Driving safety"). */
export const MAX_INTERACTION_SPEED_KMH = 10;

/**
 * Whether interactive UI may be shown at this speed. Strictly above 10 km/h is blocked.
 * Unknown speed (no GPS / permission denied) is allowed: the app degrades gracefully to manual use.
 * An invalid reading (NaN) is treated as unknown.
 */
export function isInteractionAllowed(speedKmh: number | null | undefined): boolean {
  if (speedKmh === null || speedKmh === undefined || Number.isNaN(speedKmh)) return true;
  return speedKmh <= MAX_INTERACTION_SPEED_KMH;
}
