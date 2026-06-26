/**
 * Mapping between a number parameter's value and a normalized [0, 1] position
 * (what a knob/slider tracks). Linear is the identity mapping over the range;
 * exponential gives finer control near the bottom of the range, which is what
 * you want for frequency and time controls.
 *
 * Pure functions, reused by the UI `Knob` and unit-tested directly.
 */
import type { NumberSpec } from "./types";

/** Exponential taper needs strictly positive bounds; fall back to linear otherwise. */
function isExponential(spec: NumberSpec): boolean {
  return spec.taper === "exponential" && spec.min > 0 && spec.max > 0;
}

/** value -> normalized position in [0, 1]. */
export function toNormalized(spec: NumberSpec, value: number): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  if (isExponential(spec)) {
    const logMin = Math.log(spec.min);
    const logMax = Math.log(spec.max);
    return (Math.log(clamped) - logMin) / (logMax - logMin);
  }
  return (clamped - spec.min) / (spec.max - spec.min);
}

/** normalized position in [0, 1] -> value. */
export function fromNormalized(spec: NumberSpec, t: number): number {
  const clampedT = Math.min(1, Math.max(0, t));
  if (isExponential(spec)) {
    const logMin = Math.log(spec.min);
    const logMax = Math.log(spec.max);
    return Math.exp(logMin + clampedT * (logMax - logMin));
  }
  return spec.min + clampedT * (spec.max - spec.min);
}
