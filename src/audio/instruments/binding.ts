/**
 * Shared binding helpers for instruments. A `ParamBinding` applies a parameter
 * value to the audio graph; today every binding targets a native AudioParam or
 * per-voice state. This is the seam that keeps each instrument's ParamStore
 * transport-agnostic (a worklet-backed param would only change its binding).
 */
import type { ParamValue } from '../params/types';

export interface ParamBinding {
  apply(value: ParamValue, smoothMs?: number): void;
}

/** Ramp a native AudioParam toward a value, smoothing if requested. */
export function rampParam(
  ctx: BaseAudioContext,
  param: AudioParam,
  value: number,
  smoothMs?: number,
): void {
  const now = ctx.currentTime;
  if (smoothMs && smoothMs > 0) {
    param.setTargetAtTime(value, now, smoothMs / 1000);
  } else {
    param.setValueAtTime(value, now);
  }
}

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
