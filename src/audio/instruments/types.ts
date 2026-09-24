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
  /**
   * Resolves once the instrument's async assets (e.g. decoded samples) are loaded, so an
   * offline render can wait before `startRendering` (which runs to completion immediately -
   * an undecoded sampler would otherwise render silent). Omitted by instruments with no async
   * assets (the synths); live playback never needs it (buffers stream in as they decode).
   */
  ready?(): Promise<void>;
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
  /**
   * Set once the voice is let go: its gain holds at `level` until `from` (a one-shot playing out,
   * or its own envelopes' release), then ramps to 0 by `until`. What lets Stop, or a new note past
   * the voice cap, cut it from its true level at any moment without a click.
   */
  fade?: { from: number; level: number; until: number };
  /** The voice's own envelopes, when it has any (a graph voice with `env` nodes, INST-12). */
  envelope?: VoiceEnvelope;
}

export interface VoiceEnvelope {
  /**
   * Whether they shape the voice's amplitude (a graph wired to `out`). The base's attack/release
   * then steps aside for a few milliseconds' fade at either end, which only stops the clicks.
   */
  ownsAmplitude: boolean;
  /** Let go of the note at `at`; returns how many seconds the voice must keep sounding. */
  release(at: number): number;
  /** When its one-shot samples finish (context time, 0 for none): letting go of the note never
   *  cuts them short, so the voice fades no earlier than this. */
  playsUntil: number;
}
