/**
 * Pure band-limited oscillator DSP (no Web Audio), shared by the Nimbus synth's
 * worklet processor. Naive saw/pulse waveforms alias badly at high notes (their hard
 * edges contain energy above Nyquist that folds back as inharmonic garbage). PolyBLEP
 * rounds each discontinuity with a two-sample polynomial correction, which removes
 * most of that aliasing cheaply - good enough for a subtractive voice, and far lighter
 * than oversampling.
 *
 * All oscillators take `phase` in [0, 1) and `dt` = phase increment per sample
 * (= frequency / sampleRate), and return roughly [-1, 1].
 */

/**
 * The PolyBLEP residual around a step discontinuity at fractional phase `t` with
 * increment `dt`: nonzero only within one sample either side of the edge.
 */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Band-limited sawtooth (falling edge corrected). */
export function polyBlepSaw(phase: number, dt: number): number {
  return 2 * phase - 1 - polyBlep(phase, dt);
}

/**
 * Band-limited rectangular pulse with duty cycle `pw` (0..1): a square at pw = 0.5,
 * narrowing toward a spike as pw approaches 0 or 1. Both edges are BLEP-corrected.
 */
export function polyBlepPulse(phase: number, dt: number, pw: number): number {
  let value = phase < pw ? 1 : -1;
  value += polyBlep(phase, dt); // rising edge at phase 0
  let down = phase - pw; // falling edge at phase pw
  if (down < 0) down += 1;
  value -= polyBlep(down, dt);
  return value;
}
