/**
 * The primitive vocabulary as pure data: for each node kind, which of its fields are
 * modulatable AudioParams (valid `.param` connection targets and ramped bindings) and
 * which are set-once properties (waveform, filter type). DOM-free on purpose - the Web
 * Audio builders (nodes.ts) realize these fields, but `validate.ts`, the def zod layer,
 * and the Node MCP server all describe/validate a def against this without importing Web
 * Audio. This is the canonical field list; nodes.ts mirrors it with concrete getters.
 */
import type { NodeSpec } from "./types";

export interface KindVocabulary {
  /** Fields that map to an AudioParam (modulatable; usable as a `nodeId.param` target). */
  audioParams: readonly string[];
  /** Fields that map to an enum/string property. */
  properties: readonly string[];
  /**
   * What it is and how to use it, in a line, for whoever authors a def - `describe_device_format`
   * lists these, so a new kind reaches the agent by being added here.
   */
  summary: string;
}

export const VOCABULARY: Record<NodeSpec["kind"], KindVocabulary> = {
  osc: {
    audioParams: ["frequency", "detune"],
    properties: ["waveform"],
    summary:
      "Oscillator: waveform sine|sawtooth|square|triangle. Tracks the played note unless given an absolute `frequency` (an LFO); `noteRatio` multiplies the note.",
  },
  gain: {
    audioParams: ["gain"],
    properties: [],
    summary: "Multiplies its input: a level, a VCA, or a modulation depth.",
  },
  // `detune` is in cents, so an envelope into it sweeps the cutoff by musical intervals, not Hz.
  biquad: {
    audioParams: ["frequency", "detune", "q", "gain"],
    properties: ["filterType"],
    summary:
      "Filter: filterType lowpass|highpass|bandpass|lowshelf|highshelf|peaking|notch|allpass. Modulate `detune` (cents) to sweep the cutoff musically.",
  },
  delay: {
    audioParams: ["delayTime"],
    properties: [],
    summary:
      "Delay line: `delayTime` in seconds, up to `maxSeconds` (default 1). Feed it back through a gain for echoes.",
  },
  shaper: {
    audioParams: [],
    properties: [],
    summary:
      "Waveshaper: `curve: { shape, amount }`, shape classic|tanh|hardClip|fold, amount the drive from 0 (clean) to about 100.",
  },
  // Its fields are times read at note-on and note-off, not AudioParams: an envelope is a source to
  // wire elsewhere, and nothing modulates it.
  env: {
    audioParams: [],
    properties: [],
    summary: "ADSR envelope, instruments only: attack/decay/release in ms, sustain 0..1. See `envelopes`.",
  },
  // INST-13's native nodes. Noise's colour and a convolver's impulse are set when built, not live.
  noise: {
    audioParams: [],
    properties: [],
    summary:
      "Noise source, `color` white|pink. Through a bandpass and a short envelope it is a snare or hat; through a lowpass, breath or wind.",
  },
  constant: {
    audioParams: ["offset"],
    properties: [],
    summary: "A steady signal at `offset`: add it to a modulation as a base, or scale it through a gain.",
  },
  pan: { audioParams: ["pan"], properties: [], summary: "Stereo placement: `pan` from -1 (left) to 1 (right)." },
  compressor: {
    audioParams: ["threshold", "knee", "ratio", "attack", "release"],
    properties: [],
    summary: "Compressor: threshold and knee in dB, ratio, attack and release in seconds.",
  },
  buffer: {
    audioParams: ["playbackRate", "detune"],
    properties: [],
    summary:
      "Sample player, instruments only: `sample` a ref from list_samples or a `sample` param; plays at its pitch on `root` (MIDI, default 60) and follows the note unless `keytrack: false`. `oneShot` (default true) plays to the end for drums; false stops with the note.",
  },
  convolver: {
    audioParams: [],
    properties: [],
    summary:
      'Reverb: `impulse: { shape: "decay", seconds }`, a generated tail of that length. Mix it with the dry signal in an effect.',
  }, // `impulse` is a composite field, like a shaper's curve
};

/** Kinds that follow a played note, so only make sense in an instrument voice. */
export const GATED_KINDS: readonly NodeSpec["kind"][] = ["env", "buffer"];

export const NODE_KINDS = Object.keys(VOCABULARY) as NodeSpec["kind"][];

/** Whether a kind is part of the vocabulary. */
export function isKnownKind(kind: string): kind is NodeSpec["kind"] {
  return kind in VOCABULARY;
}

/** Whether `field` is a modulatable AudioParam of `kind` (a valid `.param` target). */
export function isAudioParam(kind: NodeSpec["kind"], field: string): boolean {
  return VOCABULARY[kind].audioParams.includes(field);
}
