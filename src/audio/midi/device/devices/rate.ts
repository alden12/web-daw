/**
 * Note divisions shared by the clock-driven devices. The option list is the single source
 * for the `rate` enum in their schemas (catalog.ts) and for the beats-per-step math their
 * strategies do, so a new division shows up in every device at once instead of drifting.
 */

/** Note division -> beats (a beat is a quarter note; `T` is a triplet = x 2/3). */
const RATE_BEATS: Record<string, number> = {
  "1/4": 1,
  "1/4T": 2 / 3,
  "1/8": 0.5,
  "1/8T": 1 / 3,
  "1/16": 0.25,
  "1/16T": 1 / 6,
  "1/32": 0.125,
};

/** The divisions offered by a `rate` param, slowest first. */
export const RATE_OPTIONS = Object.keys(RATE_BEATS);

export function rateToBeats(rate: string): number {
  return RATE_BEATS[rate] ?? 0.5;
}
