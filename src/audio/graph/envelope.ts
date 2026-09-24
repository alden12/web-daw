/**
 * The ADSR envelope an `env` node plays (INST-12), as pure timing math plus the calls that put it
 * on an AudioParam. Linear segments throughout, like the base instrument's amp envelope, because a
 * linear envelope's level at any moment is a line of arithmetic. Release needs exactly that: it
 * anchors the param at its true current level before ramping down, rather than trusting
 * `cancelAndHoldAtTime`, whose Chrome bug starts the next ramp from the wrong value and clicks (see
 * `BaseInstrument.releaseVoice`).
 */

/** An envelope's shape, in seconds and a 0..1 sustain level. */
export interface EnvelopeShape {
  attack: number;
  decay: number;
  sustain: number;
}

/** The shortest segment scheduled, so a zero time is a very fast ramp rather than a step (a click). */
const MIN_SEGMENT_SECONDS = 0.001;

/** Coerce authored values into something playable: times at least a millisecond, sustain 0..1. */
export const normalizeShape = (shape: EnvelopeShape): EnvelopeShape => ({
  attack: Math.max(MIN_SEGMENT_SECONDS, shape.attack),
  decay: Math.max(MIN_SEGMENT_SECONDS, shape.decay),
  sustain: Math.min(1, Math.max(0, shape.sustain)),
});

export const normalizeRelease = (seconds: number): number => Math.max(MIN_SEGMENT_SECONDS, seconds);

/** The level of an envelope started at `start`, at time `at`, while the note is still held. */
export function heldLevelAt(shape: EnvelopeShape, start: number, at: number): number {
  const elapsed = at - start;
  if (elapsed <= 0) return 0;
  if (elapsed < shape.attack) return elapsed / shape.attack;
  const intoDecay = elapsed - shape.attack;
  if (intoDecay < shape.decay) return 1 - (1 - shape.sustain) * (intoDecay / shape.decay);
  return shape.sustain;
}

/** Schedule the held part of the envelope: 0 at `start`, up to 1, down to sustain, and hold. */
export function scheduleAttack(param: AudioParam, shape: EnvelopeShape, start: number): void {
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(1, start + shape.attack);
  param.linearRampToValueAtTime(shape.sustain, start + shape.attack + shape.decay);
}

/** Schedule the release from wherever the envelope has got to at `at`, down to 0 over `release`. */
export function scheduleRelease(
  param: AudioParam,
  shape: EnvelopeShape,
  start: number,
  at: number,
  release: number,
): void {
  param.cancelScheduledValues(at);
  param.setValueAtTime(heldLevelAt(shape, start, at), at);
  param.linearRampToValueAtTime(0, at + release);
}
