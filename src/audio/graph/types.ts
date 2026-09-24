/**
 * The declarative instrument/effect format: an instrument or effect described as
 * *data* - a small graph of curated primitive nodes plus inline parameter bindings -
 * rather than a hand-written class. The graph is interpreted at runtime (build.ts)
 * into a Web Audio node graph, driven by the same ParamStore/schema keystone as the
 * class-based instruments, so UI, MCP, automation, and persistence are unchanged.
 *
 * This is the format the AI-authored / user library will target (see INST-4).
 * It is deliberately small: a handful of node kinds (nodes.ts), literal-or-param
 * field values with an optional linear transform, and connections that target either
 * a node's audio input or one of its AudioParams (for modulation).
 */
import type { ParamSchema } from "../params/types";

// Local unions (not the DOM-lib OscillatorType/BiquadFilterType/OverSampleType) so this file -
// the def format - stays DOM-free and can be imported by the Node MCP server. The Web Audio
// builders (nodes.ts) cast these to the DOM types when setting a node property.
export type OscWaveform = "sine" | "sawtooth" | "square" | "triangle";
export type FilterKind =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";
export type Oversample = "none" | "2x" | "4x";

/** A parameter reference: the param value, optionally scaled/offset (value*scale + offset). */
export interface ParamRef {
  param: string;
  scale?: number;
  offset?: number;
}

/** One point of a lookup table: this param value in, this field value out. */
export type TablePoint = [input: number, output: number];

/**
 * A numeric parameter reference. With a `table`, the param's value is first read off it
 * (straight lines between points, the end values beyond them), then scaled and offset: the way
 * to make a field a non-linear function of a knob (INST-17).
 */
export interface NumberRef extends ParamRef {
  table?: TablePoint[];
}

/** A numeric field: a fixed value, or bound to a parameter. */
export type NumberField = number | NumberRef;
/** An enum/string field (e.g. a waveform): a fixed value, or bound to a parameter. */
export type EnumField<T extends string> = T | ParamRef;
/** A switch: fixed, or bound to a boolean parameter. */
export type BoolField = boolean | ParamRef;

/** An oscillator. In an instrument voice graph its frequency tracks the note by
 *  default; `noteRatio` multiplies the note (FM ratio, sub-octave); `frequency`
 *  sets an absolute Hz (an effect LFO). */
export interface OscNodeSpec {
  id: string;
  kind: "osc";
  waveform?: EnumField<OscWaveform>;
  frequency?: NumberField;
  noteRatio?: NumberField;
  detune?: NumberField;
}

export interface GainNodeSpec {
  id: string;
  kind: "gain";
  gain?: NumberField;
}

export interface BiquadNodeSpec {
  id: string;
  kind: "biquad";
  filterType?: FilterKind;
  frequency?: NumberField;
  q?: NumberField;
  gain?: NumberField;
}

export interface DelayNodeSpec {
  id: string;
  kind: "delay";
  /** Maximum delay time (construction bound), seconds. */
  maxSeconds?: number;
  delayTime?: NumberField;
}

/** The curated waveshaper curve families (see nodes.ts `SHAPER_CURVES`); `amount` is the drive. */
export const SHAPER_SHAPES = ["classic", "tanh", "hardClip", "fold"] as const;
export type ShaperShape = (typeof SHAPER_SHAPES)[number];

export interface ShaperNodeSpec {
  id: string;
  kind: "shaper";
  oversample?: Oversample;
  curve: { shape: ShaperShape; amount: NumberField };
}

/**
 * An ADSR envelope, instruments only (INST-12): a control signal that rises 0 -> 1 over `attack`
 * when the note starts, falls to `sustain` over `decay`, holds there while the note is held, and
 * falls to 0 over `release` once it is let go. Wire it like an LFO - into a `gain` to scale it,
 * then into any `.param` - so one envelope sweeps a filter, bends a pitch, or shapes the
 * amplitude when the voice is wired to `out`. Times are milliseconds, sustain is 0..1. Attack,
 * decay and sustain are read when the note starts, release when it ends.
 */
export interface EnvNodeSpec {
  id: string;
  kind: "env";
  attack?: NumberField;
  decay?: NumberField;
  sustain?: NumberField;
  release?: NumberField;
}

/** Noise colours: white is flat; pink falls 3 dB an octave, softer and closer to rain than hiss. */
export const NOISE_COLORS = ["white", "pink"] as const;
export type NoiseColor = (typeof NOISE_COLORS)[number];

/** A noise source (INST-13): hats, snares, breath, wind. Runs until the voice or effect stops. */
export interface NoiseNodeSpec {
  id: string;
  kind: "noise";
  color?: NoiseColor;
}

/** A steady signal at `offset`: an offset to add to a modulation, or a level to scale. */
export interface ConstantNodeSpec {
  id: string;
  kind: "constant";
  offset?: NumberField;
}

/** Stereo placement, -1 (left) to 1 (right). */
export interface PanNodeSpec {
  id: string;
  kind: "pan";
  pan?: NumberField;
}

/** A dynamics compressor. Threshold and knee in dB, attack and release in seconds, as Web Audio has them. */
export interface CompressorNodeSpec {
  id: string;
  kind: "compressor";
  threshold?: NumberField;
  knee?: NumberField;
  ratio?: NumberField;
  attack?: NumberField;
  release?: NumberField;
}

/** The curated impulse families a convolver can be given (see nodes.ts `IMPULSES`). */
export const IMPULSE_SHAPES = ["decay"] as const;
export type ImpulseShape = (typeof IMPULSE_SHAPES)[number];

/**
 * Convolution, for reverb: the input played through an impulse response. The impulse is generated
 * rather than recorded - `decay` is noise fading over `seconds`, the original Reverb's tail - so a
 * def carries no audio and nothing needs licensing.
 */
export interface ConvolverNodeSpec {
  id: string;
  kind: "convolver";
  impulse: { shape: ImpulseShape; seconds: NumberField };
}

/**
 * Sample playback (INST-13), instruments only. `sample` is a sample ref (`builtin:kick`, as
 * `list_samples` gives them) or bound to a `sample` parameter so it can be swapped from a picker.
 * It plays at its own pitch on the `root` note (MIDI, default 60) and follows the played note from
 * there, unless `keytrack` is off.
 *
 * `oneShot` (the default) plays it to the end however short the note - drums. Off, it stops with
 * the note and its release - a sustained sound. Samples are decoded when the instrument loads, and a
 * note played before its sample is ready is silent rather than an error.
 *
 * `start` skips that many milliseconds into the sample, to trim a recording that caught some silence
 * or a false start before the sound.
 *
 * `note` makes it sound only for that MIDI note, which is how a drum kit is built: one buffer per
 * pad, each on its own note. Nodes for the other pads are left out of the voice (prune.ts).
 */
export interface BufferNodeSpec {
  id: string;
  kind: "buffer";
  sample: EnumField<string>;
  note?: NumberField;
  root?: NumberField;
  keytrack?: BoolField;
  detune?: NumberField;
  oneShot?: BoolField;
  /** Milliseconds into the sample to start playing from (default 0). Read when the note starts. */
  start?: NumberField;
}

/**
 * Custom-DSP blocks (INST-15): each runs our own code on the audio thread (an AudioWorklet)
 * rather than a browser node, and is otherwise an ordinary node - its fields bind and modulate
 * like any other's. In an instrument voice each note gets its own copy, which costs more than a
 * native node, so a voice using one plays fewer notes at once (WORKLET_VOICE_CAP).
 */

/** A Moog-style four-pole resonant low-pass: `frequency` in Hz, `resonance` 0..1 (self-oscillates
 *  near 1), and `detune` in cents on top of the frequency, for sweeps in musical intervals. */
export interface LadderNodeSpec {
  id: string;
  kind: "ladder";
  frequency?: NumberField;
  resonance?: NumberField;
  detune?: NumberField;
}

/** Lo-fi degradation: `bits` of depth (1..16) and `downsample`, holding each sample for that many
 *  frames (1..50). */
export interface BitcrushNodeSpec {
  id: string;
  kind: "bitcrush";
  bits?: NumberField;
  downsample?: NumberField;
}

/** The waveforms of an `analogOsc`: a sawtooth, or a pulse whose width is `pulseWidth`. */
export const ANALOG_WAVEFORMS = ["saw", "pulse"] as const;
export type AnalogWaveform = (typeof ANALOG_WAVEFORMS)[number];

/**
 * An analog-style oscillator: alias-free (PolyBLEP) saw or pulse, and a pulse whose `pulseWidth`
 * (0..1, 0.5 a square) can be modulated - pulse-width modulation, which `osc` cannot do. Its
 * frequency follows the note like an `osc`'s (`noteRatio`, or an absolute `frequency`).
 */
export interface AnalogOscNodeSpec {
  id: string;
  kind: "analogOsc";
  waveform?: EnumField<AnalogWaveform>;
  frequency?: NumberField;
  noteRatio?: NumberField;
  detune?: NumberField;
  pulseWidth?: NumberField;
}

export type NodeSpec =
  | AnalogOscNodeSpec
  | LadderNodeSpec
  | BitcrushNodeSpec
  | BufferNodeSpec
  | OscNodeSpec
  | GainNodeSpec
  | BiquadNodeSpec
  | DelayNodeSpec
  | ShaperNodeSpec
  | EnvNodeSpec
  | NoiseNodeSpec
  | ConstantNodeSpec
  | PanNodeSpec
  | CompressorNodeSpec
  | ConvolverNodeSpec;

/**
 * A connection `[from, to]`. `to` is a node id (connect into its audio input) or
 * `"nodeId.param"` to modulate that node's AudioParam. Reserved ids: `amp` (an
 * instrument voice's output through the built-in attack/release envelope), `out` (the
 * voice's output as-is, for a voice that shapes its own amplitude with an `env`), and
 * `in` / `wet` (an effect's input / wet bus). A voice uses `amp` or `out`, not both.
 */
export type Connection = [from: string, to: string];

export interface Graph {
  nodes: NodeSpec[];
  connections: Connection[];
}

/** An instrument as data: its schema (the keystone) + a per-voice graph. */
export interface GraphInstrumentDef {
  type: string;
  /** Human-facing name for the library/palette (defaults from the catalog entry). */
  label?: string;
  schema: ParamSchema;
  voice: Graph;
}

/** An effect as data: its schema (incl. the uniform `mix`) + a graph over `in`/`wet`. */
export interface GraphEffectDef {
  type: string;
  label?: string;
  schema: ParamSchema;
  graph: Graph;
}
