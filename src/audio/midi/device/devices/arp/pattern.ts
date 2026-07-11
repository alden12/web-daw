/**
 * Pure arpeggiator note math: given the held pitches (sorted ascending), a pattern, an
 * octave span, and a running step index, which pitch does this step play? And how many
 * beats is one step at a given rate. No audio, no clock, no state - unit-tested in
 * isolation; the arp strategy drives it on the transport grid.
 */
export type ArpPattern = "up" | "down" | "updown" | "random";

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

export function rateToBeats(rate: string): number {
  return RATE_BEATS[rate] ?? 0.5;
}

/** Deterministic pseudo-random index for the `random` pattern (stable per step, testable). */
const hashStep = (stepIndex: number): number => (Math.imul(stepIndex + 1, 2654435761) >>> 0) % 1000000;

/** The chord stacked across `octaves` (each octave shifted +12), ascending. */
function stack(sortedPitches: number[], octaves: number): number[] {
  const span = Math.max(1, Math.round(octaves));
  const out: number[] = [];
  for (let octave = 0; octave < span; octave++) for (const pitch of sortedPitches) out.push(pitch + 12 * octave);
  return out;
}

/**
 * The pitch this step plays, or null when no notes are held. `stepIndex` is a monotonic
 * counter; the pattern maps it to a position in the stacked chord (wrapping). `updown`
 * ascends then descends without repeating the peak/trough; `random` picks deterministically.
 */
export function arpPitch(
  sortedPitches: number[],
  pattern: ArpPattern,
  octaves: number,
  stepIndex: number,
): number | null {
  if (sortedPitches.length === 0) return null;
  const stacked = stack(sortedPitches, octaves);
  if (pattern === "random") return stacked[hashStep(stepIndex) % stacked.length];
  const sequence =
    pattern === "down"
      ? [...stacked].reverse()
      : pattern === "updown"
        ? [...stacked, ...stacked.slice(1, -1).reverse()]
        : stacked; // "up"
  const wrapped = ((stepIndex % sequence.length) + sequence.length) % sequence.length;
  return sequence[wrapped];
}
