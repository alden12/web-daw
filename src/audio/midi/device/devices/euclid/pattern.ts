/**
 * Pure Euclidean rhythm math: given a number of steps and a number of pulses, which steps
 * are onsets? No audio, no clock, no state - unit-tested in isolation; the Euclidean strategy
 * drives it on the transport grid.
 *
 * This is Bjorklund's algorithm (Toussaint, "The Euclidean Algorithm Generates Traditional
 * Musical Rhythms"): distribute `pulses` onsets as evenly as possible across `steps`. It yields
 * the canonical necklaces - E(3,8) = x..x..x. (tresillo), E(5,8) = x.xx.xx. (cinquillo),
 * E(5,16), E(7,16) and so on - which is what a Torso T-1 style sequencer steps through.
 */

/**
 * Repeatedly fold the shorter group list into the longer one. Starting from `pulses` groups
 * of [onset] and `steps - pulses` groups of [rest], each pass pairs them off; when only one
 * group (or none) is left over the sequence is maximally even and we flatten it.
 */
function bjorklund(steps: number, pulses: number): boolean[] {
  let front: boolean[][] = Array.from({ length: pulses }, () => [true]);
  let remainder: boolean[][] = Array.from({ length: steps - pulses }, () => [false]);

  while (remainder.length > 1) {
    const pairs = Math.min(front.length, remainder.length);
    const merged = front.slice(0, pairs).map((group, index) => [...group, ...remainder[index]]);
    const leftoverFront = front.slice(pairs);
    front = merged;
    remainder = leftoverFront.length > 0 ? leftoverFront : remainder.slice(pairs);
  }

  return [...front, ...remainder].flat();
}

/**
 * The Euclidean pattern as a boolean per step (`true` = onset).
 *
 * `rotate` turns the necklace: `result[i] = base[(i + rotate) % steps]`, so raising it walks
 * the pattern's starting point through the cycle without changing which rhythm it is. Degenerate
 * inputs are clamped rather than rejected (this is a coerced, trusted value from a ParamStore,
 * not a validated boundary): no pulses = silence, pulses >= steps = every step.
 */
export function euclideanPattern(steps: number, pulses: number, rotate = 0): boolean[] {
  const stepCount = Math.max(1, Math.round(steps));
  const pulseCount = Math.max(0, Math.round(pulses));
  if (pulseCount === 0) return Array.from({ length: stepCount }, () => false);
  if (pulseCount >= stepCount) return Array.from({ length: stepCount }, () => true);

  const base = bjorklund(stepCount, pulseCount);
  const shift = ((Math.round(rotate) % stepCount) + stepCount) % stepCount;
  return base.map((_, index) => base[(index + shift) % stepCount]);
}
