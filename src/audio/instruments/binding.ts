/**
 * Instrument-side binding helpers. The generic seam (ParamBinding, rampParam,
 * bindParams) lives in params/binding.ts and is shared with effects; this module
 * re-exports it and adds the instrument-only midiToFreq.
 */
export { type ParamBinding, rampParam, bindParams } from '../params/binding';

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
