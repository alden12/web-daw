/**
 * Pure bitcrusher DSP (no Web Audio), so it is unit-testable on its own and shared
 * by the worklet processor that actually runs it. Two classic degradations:
 *
 * - **Bit-depth reduction**: snap each sample to one of 2^bits quantization levels
 *   across the [-1, 1] range, the stair-stepping that gives lo-fi its grit.
 * - **Sample-rate reduction (downsampling)**: hold a sample for `downsample` input
 *   frames before taking a new one, the aliasing "crunch". Carried per channel via a
 *   small mutable `HoldState` so the worklet keeps phase across render quanta.
 */

/** Snap a sample in [-1, 1] to one of 2^bits levels. bits <= 0 -> passthrough. */
export function quantizeSample(x: number, bits: number): number {
  if (bits <= 0) return x;
  // (levels - 1) steps across the full [-1, 1] range, rounded to the nearest.
  const steps = Math.pow(2, bits) - 1;
  return (Math.round(((x + 1) / 2) * steps) / steps) * 2 - 1;
}

/** Per-channel sample-and-hold state for the downsampler (mutate in place). */
export interface HoldState {
  /** Frames elapsed since the last fresh sample was taken. */
  counter: number;
  /** The currently held (and emitted) sample value. */
  value: number;
}

export function makeHoldState(): HoldState {
  return { counter: 0, value: 0 };
}

/**
 * One downsampling step: refresh the held value every `downsample` input frames
 * (held >= 1; values below 1 act as 1 = take every frame), else repeat the last.
 * Returns the value to emit and advances `state`.
 */
export function holdStep(input: number, downsample: number, state: HoldState): number {
  const period = downsample >= 1 ? Math.floor(downsample) : 1;
  if (state.counter <= 0) {
    state.value = input;
    state.counter = period;
  }
  state.counter -= 1;
  return state.value;
}

/** The full per-sample crush: downsample (sample-hold) then quantize. */
export function crushSample(input: number, bits: number, downsample: number, state: HoldState): number {
  return quantizeSample(holdStep(input, downsample, state), bits);
}
