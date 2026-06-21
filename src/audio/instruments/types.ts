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

/** One sounding voice: its amp gain (envelope target) and oscillators. */
export interface VoiceHandle {
  amp: GainNode;
  oscillators: OscillatorNode[];
}
