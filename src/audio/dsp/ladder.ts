/**
 * Pure Moog-style transistor-ladder low-pass DSP (no Web Audio), so it is unit-
 * testable on its own and shared by the Aurora synth's worklet processor. This is a
 * four-pole (24 dB/oct) resonant filter - the classic voltage-controlled filter whose
 * musical, self-oscillating resonance is most of what makes an analog synth sound
 * analog. It is the well-known compact ladder approximation (four cascaded one-pole
 * sections with a resonance feedback path and a cubic soft-clip), kept stable for the
 * cutoff range we drive it over.
 *
 * Coefficients are cheap to recompute, so the caller can update them per audio block
 * as the envelope / LFO move the cutoff (block-rate modulation is inaudible here).
 */

/** Per-instance filter state: the four stage outputs plus their one-sample history. */
export interface LadderState {
  y1: number;
  y2: number;
  y3: number;
  y4: number;
  oldx: number;
  oldy1: number;
  oldy2: number;
  oldy3: number;
}

export function makeLadderState(): LadderState {
  return { y1: 0, y2: 0, y3: 0, y4: 0, oldx: 0, oldy1: 0, oldy2: 0, oldy3: 0 };
}

/** Tuning coefficients for a cutoff (Hz) and resonance (0..1) at a given sample rate. */
export interface LadderCoeffs {
  p: number;
  k: number;
  r: number;
}

/**
 * Derive the ladder coefficients. `cutoffHz` is clamped to a stable fraction of the
 * sample rate; `resonance` (0..1) is scaled so ~1 reaches self-oscillation.
 */
export function ladderCoeffs(cutoffHz: number, resonance: number, sampleRate: number): LadderCoeffs {
  // Normalized cutoff in (0, 1); cap below Nyquist to keep the cascade stable.
  const f = Math.min(0.99, Math.max(0.0001, (2 * cutoffHz) / sampleRate));
  const p = f * (1.8 - 0.8 * f); // pole coefficient; each one-pole section has unity DC gain
  const k = 2 * p - 1;
  // Cutoff-compensated resonance feedback: `resonance` (0..1) maps ~linearly to r,
  // reaching self-oscillation near 1. This is the classic normalization so the amount
  // of resonance feels consistent as the cutoff moves.
  const t = (1 - p) * 1.386249;
  const t2 = 12 + t * t;
  const r = (Math.max(0, resonance) * (t2 + 6 * t)) / (t2 - 6 * t);
  return { p, k, r };
}

/** Run one input sample through the ladder, advancing `state`. Returns the output. */
export function ladderStep(input: number, coeffs: LadderCoeffs, state: LadderState): number {
  const { p, k, r } = coeffs;
  const x = input - r * state.y4; // resonance feedback
  // Four cascaded one-pole sections (bilinear-transform form).
  state.y1 = x * p + state.oldx * p - k * state.y1;
  state.y2 = state.y1 * p + state.oldy1 * p - k * state.y2;
  state.y3 = state.y2 * p + state.oldy2 * p - k * state.y3;
  state.y4 = state.y3 * p + state.oldy3 * p - k * state.y4;
  state.y4 -= (state.y4 * state.y4 * state.y4) / 6; // band-limited soft clip
  state.oldx = x;
  state.oldy1 = state.y1;
  state.oldy2 = state.y2;
  state.oldy3 = state.y3;
  return state.y4;
}
