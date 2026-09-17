/**
 * The instrument abstraction. A track owns one Instrument; the scheduler and
 * live input drive it through this interface, so the rest of the app is
 * agnostic to which engine (subtractive, FM, ...) is behind a track.
 *
 * Time-aware: noteOn/noteOff/playNote take an absolute AudioContext `when` so
 * the lookahead scheduler can place events precisely (default: now).
 */
export interface Instrument {
  /** The instrument's audio output; connect into the track's gain. */
  readonly output: AudioNode;
  noteOn(midi: number, velocity?: number, when?: number): void;
  noteOff(midi: number, when?: number): void;
  /** Fire-and-forget note that releases itself after durationSec (scheduler). */
  playNote(midi: number, durationSec: number, velocity?: number, when?: number): void;
  allNotesOff(): void;
  dispose(): void;
}

/**
 * One sounding voice: its amp gain (the envelope target) and its scheduled
 * sound sources. Sources are `AudioScheduledSourceNode`s - oscillators for the
 * synths, an `AudioBufferSourceNode` for the sampler - so the base owns
 * start/stop/cleanup uniformly regardless of what produces the sound.
 */
export interface VoiceHandle {
  amp: GainNode;
  sources: AudioScheduledSourceNode[];
  /**
   * Attack envelope bookkeeping the base fills in at note-on (level = the sustain gain,
   * attackStart/attackEnd = the attack ramp window). Release reads these to anchor the
   * gain at its true value before ramping down, instead of relying on cancelAndHoldAtTime
   * (whose Chrome bug leaves the following ramp starting from the wrong value - an instant
   * step to ~0, i.e. the note-off click).
   */
  level?: number;
  attackStart?: number;
  attackEnd?: number;
}
