/**
 * The instrument catalog: pure data (labels + parameter schemas), no audio/DOM.
 * This is what the ProjectStore and the Node MCP server consume to build param
 * stores and describe instruments. The audio factories live in registry.ts
 * (DOM); keeping them apart lets the server type-check without Web Audio types.
 *
 * Instruments are *registered*, not hardcoded: built-ins self-register at the
 * bottom of this file, and `registerInstrument` is the extension point an
 * add-on (eventually a plugin package) calls to contribute a new instrument
 * without editing the core. Because the parameter schema is the keystone, a
 * registered instrument appears in the UI, the MCP palette, automation, and
 * persistence automatically. (Runtime registration trades the old compile-time
 * "every cataloged type has a factory" check for external extensibility; the
 * factory half lives in registry.ts and is registered alongside.)
 */
import type { ParamSchema, ParamSpec } from "../params/types";
import { BUILTIN_SAMPLES, builtinRef } from "../samples/catalog";

export const WAVEFORMS = ["sine", "sawtooth", "square", "triangle"] as const;
export type Waveform = (typeof WAVEFORMS)[number];

export const subtractiveSchema: ParamSchema = [
  { id: "osc.waveform", label: "Waveform", kind: "enum", options: WAVEFORMS, default: "sawtooth" },
  {
    id: "osc.detune",
    label: "Detune",
    kind: "number",
    min: -100,
    max: 100,
    default: 0,
    unit: "cents",
    taper: "linear",
    smoothMs: 20,
  },
  {
    id: "filter.cutoff",
    label: "Cutoff",
    kind: "number",
    min: 20,
    max: 20000,
    default: 4000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 15,
  },
  {
    id: "filter.resonance",
    label: "Resonance",
    kind: "number",
    min: 0.0001,
    max: 24,
    default: 1,
    unit: "Q",
    taper: "linear",
    smoothMs: 15,
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 5,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 200,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const fmSchema: ParamSchema = [
  { id: "fm.ratio", label: "Ratio", kind: "number", min: 0.5, max: 12, default: 2, taper: "linear" },
  { id: "fm.index", label: "Index", kind: "number", min: 0, max: 4000, default: 300, unit: "Hz", taper: "linear" },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 4,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 250,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const supersawSchema: ParamSchema = [
  { id: "super.voices", label: "Voices", kind: "number", min: 1, max: 9, default: 7, taper: "linear" },
  {
    id: "super.detune",
    label: "Detune",
    kind: "number",
    min: 0,
    max: 100,
    default: 25,
    unit: "cents",
    taper: "linear",
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 8,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 300,
    unit: "ms",
    taper: "exponential",
  },
] as const;

export const organSchema: ParamSchema = [
  { id: "organ.brightness", label: "Brightness", kind: "number", min: 0, max: 1, default: 0.5, taper: "linear" },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 10,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 120,
    unit: "ms",
    taper: "exponential",
  },
] as const;

// Mellotron Flute: a warm, breathy tape-flute (the Strawberry Fields sound), built as a
// declarative graph (graph/mellotronFlute.ts). Two triangle oscillators spread apart for
// the tape chorus, a unison sine for body, a shared vibrato LFO, and a mellow lowpass.
export const mellotronFluteSchema: ParamSchema = [
  {
    id: "tone.warmth",
    label: "Warmth",
    kind: "number",
    min: 300,
    max: 8000,
    default: 2400,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 20,
  },
  { id: "tone.spread", label: "Chorus", kind: "number", min: 0, max: 30, default: 10, unit: "cents", smoothMs: 25 },
  { id: "body.level", label: "Body", kind: "number", min: 0, max: 1, default: 0.35, taper: "linear", smoothMs: 20 },
  {
    id: "vibrato.rate",
    label: "Vibrato Rate",
    kind: "number",
    min: 0.1,
    max: 8,
    default: 4.8,
    unit: "Hz",
    smoothMs: 30,
  },
  {
    id: "vibrato.depth",
    label: "Vibrato Depth",
    kind: "number",
    min: 0,
    max: 40,
    default: 7,
    unit: "cents",
    smoothMs: 30,
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.85, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 95,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 480,
    unit: "ms",
    taper: "exponential",
  },
] as const;

// Morphing wavetable synth (AudioWorklet). Param ids match the processor's AudioParam
// names so WorkletInstrument binds them generically; smoothMs keeps the morph zipper-free.
export const wavetableSchema: ParamSchema = [
  { id: "wt.position", label: "Position", kind: "number", min: 0, max: 1, default: 0, taper: "linear", smoothMs: 20 },
  { id: "wt.tone", label: "Tone", kind: "number", min: 0, max: 1, default: 0.6, taper: "linear", smoothMs: 20 },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 8,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 300,
    unit: "ms",
    taper: "exponential",
  },
] as const;

// Nimbus: a warm, Juno-inspired polyphonic subtractive synth (AudioWorklet). Param ids
// match the processor's AudioParam names so WorkletInstrument binds them generically;
// smoothMs keeps knob moves zipper-free. See instruments/nimbus.worklet.ts.
export const nimbusSchema: ParamSchema = [
  { id: "osc.saw", label: "Saw", kind: "number", min: 0, max: 1, default: 0.8, taper: "linear", smoothMs: 15 },
  { id: "osc.pulse", label: "Pulse", kind: "number", min: 0, max: 1, default: 0, taper: "linear", smoothMs: 15 },
  {
    id: "osc.pulseWidth",
    label: "Pulse Width",
    kind: "number",
    min: 0.05,
    max: 0.95,
    default: 0.5,
    taper: "linear",
    smoothMs: 15,
  },
  { id: "osc.sub", label: "Sub", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear", smoothMs: 15 },
  { id: "osc.noise", label: "Noise", kind: "number", min: 0, max: 1, default: 0, taper: "linear", smoothMs: 15 },
  { id: "osc.drift", label: "Drift", kind: "number", min: 0, max: 1, default: 0.2, taper: "linear" },
  {
    id: "filter.cutoff",
    label: "Cutoff",
    kind: "number",
    min: 20,
    max: 18000,
    default: 3000,
    unit: "Hz",
    taper: "exponential",
    smoothMs: 15,
  },
  {
    id: "filter.resonance",
    label: "Resonance",
    kind: "number",
    min: 0,
    max: 1,
    default: 0.2,
    taper: "linear",
    smoothMs: 15,
  },
  {
    id: "filter.env",
    label: "Env Amount",
    kind: "number",
    min: -1,
    max: 1,
    default: 0.4,
    taper: "linear",
    smoothMs: 15,
  },
  { id: "filter.keytrack", label: "Keytrack", kind: "number", min: 0, max: 1, default: 0.3, taper: "linear" },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 4000,
    default: 6,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.decay",
    label: "Decay",
    kind: "number",
    min: 1,
    max: 4000,
    default: 200,
    unit: "ms",
    taper: "exponential",
  },
  { id: "env.sustain", label: "Sustain", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear" },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 6000,
    default: 300,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "lfo.rate",
    label: "LFO Rate",
    kind: "number",
    min: 0.05,
    max: 20,
    default: 5,
    unit: "Hz",
    taper: "exponential",
  },
  { id: "lfo.pitch", label: "LFO Pitch", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
  { id: "lfo.filter", label: "LFO Filter", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
  { id: "lfo.pwm", label: "LFO PWM", kind: "number", min: 0, max: 1, default: 0, taper: "linear" },
  { id: "lfo.delay", label: "LFO Delay", kind: "number", min: 0, max: 4000, default: 0, unit: "ms", taper: "linear" },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.7, taper: "linear", smoothMs: 10 },
] as const;

// One-shot sampler. `sampler.sample` is the keystone's `sample` kind - a ref into
// the built-in kit (or, later, an imported file); the picker fills the choices.
// Short envelope by default since notes play the whole sample (percussive).
export const samplerSchema: ParamSchema = [
  { id: "sampler.sample", label: "Sample", kind: "sample", default: "builtin:kick" },
  { id: "sampler.root", label: "Root", kind: "number", min: 0, max: 127, default: 60, taper: "linear" },
  { id: "sampler.keytrack", label: "Keytrack", kind: "boolean", default: true },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.85, taper: "linear", smoothMs: 10 },
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 1,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 5,
    unit: "ms",
    taper: "exponential",
  },
] as const;

// Drum kit: a multi-pad sample player. A played MIDI note *selects a pad* (it does not
// pitch the sample); which note fires a pad is a per-pad param (`pad{n}.note`), defaulting
// to the built-in sound's General MIDI drum note (kick = 36, snare = 38, ...) so the kit
// follows the GM standard - the mapping is data (visible in the panel, settable over MCP,
// freely remappable) rather than hardcoded.
// Each pad is a `sample` ref + note + level + tune, so the whole kit is schema-driven (no
// per-pad code) - the sectioned instrument panel renders one section per pad, and
// MCP/persistence come for free. Defaults load the built-in CC0 kit into the first pads.
// See Drumkit.ts (which resolves note -> pad from those params at play time).
// The schema declares the maximum pad slots; the drum panel shows only the pads in use
// (loaded, plus one you're adding) so a fresh kit isn't a wall of blanks.
export const DRUMKIT_PADS = 32;
export const DRUMKIT_BASE_NOTE = 36; // GM note 36 (kick), where the General MIDI drum map begins

/** Fallback default note for a 0-based pad index, for pads past the built-in kit (which
 *  seed their note from the sample's General MIDI note). Contiguous from the GM base. */
export const noteForPad = (padIndex: number): number => DRUMKIT_BASE_NOTE + padIndex;

const drumPadSpecs = (): ParamSpec[] =>
  Array.from({ length: DRUMKIT_PADS }, (_unused, index): ParamSpec[] => {
    const pad = index + 1;
    const builtin = BUILTIN_SAMPLES[index]; // seed the first pads with the built-in kit
    return [
      { id: `pad${pad}.sample`, label: "Sample", kind: "sample", default: builtin ? builtinRef(builtin.id) : "" },
      {
        id: `pad${pad}.note`,
        label: "Note",
        kind: "number",
        min: 0,
        max: 127,
        // Follow the General MIDI drum map for the built-in kit (kick = 36, snare = 38,
        // ...); fall back to a contiguous layout for any extra pads.
        default: builtin?.gmNote ?? noteForPad(index),
        taper: "linear",
        format: "note", // shown as a note-name selector (C2, ...), matching the piano roll
      },
      {
        id: `pad${pad}.level`,
        label: "Level",
        kind: "number",
        min: 0,
        max: 1,
        default: 0.85,
        taper: "linear",
        smoothMs: 10,
      },
      {
        id: `pad${pad}.tune`,
        label: "Tune",
        kind: "number",
        min: -24,
        max: 24,
        default: 0,
        unit: "st",
        taper: "linear",
        step: 1, // whole semitones
      },
    ];
  }).flat();

export const drumkitSchema: ParamSchema = [
  ...drumPadSpecs(),
  // A short shared amp envelope (pads are one-shots, so these mostly just soften the
  // very start/end); amp.level is the kit master. env.* are required by the shared voice.
  {
    id: "env.attack",
    label: "Attack",
    kind: "number",
    min: 1,
    max: 2000,
    default: 1,
    unit: "ms",
    taper: "exponential",
  },
  {
    id: "env.release",
    label: "Release",
    kind: "number",
    min: 1,
    max: 4000,
    default: 40,
    unit: "ms",
    taper: "exponential",
  },
  { id: "amp.level", label: "Level", kind: "number", min: 0, max: 1, default: 0.9, taper: "linear", smoothMs: 10 },
];

export interface InstrumentInfo {
  /** Stable id used on the wire, in persistence, and to address the factory. */
  type: string;
  label: string;
  schema: ParamSchema;
  /** A default group name (kept for the catalog shape; grouping is now a single "main"). */
  family: string;
  /**
   * Hidden from the library palette + search (still registered so its schema/factory
   * resolve). Used by the "none" sentinel - an empty track with no instrument yet.
   */
  hidden?: boolean;
}

/** The sentinel instrument type for an empty track (no instrument chosen yet). */
export const EMPTY_INSTRUMENT = "none";

/** The instrument data registry (insertion order = catalog/palette order). */
const REGISTRY = new Map<string, InstrumentInfo>();

/** Register an instrument's data (label + schema + family). The audio factory is
 *  registered separately in registry.ts, so this stays DOM-free for the server. */
export function registerInstrument(info: InstrumentInfo): void {
  REGISTRY.set(info.type, info);
}

/** Remove a registered instrument (custom, project-scoped devices are unregistered on unload). */
export function unregisterInstrument(type: string): void {
  REGISTRY.delete(type);
}

/** Every registered instrument, in registration order (iterate this, never hardcode). */
export function instrumentInfos(): InstrumentInfo[] {
  return [...REGISTRY.values()];
}

/** Registered instruments a user can pick (excludes hidden sentinels like "none"). */
export function pickableInstrumentInfos(): InstrumentInfo[] {
  return [...REGISTRY.values()].filter((info) => !info.hidden);
}

/** Whether an instrument type is registered. */
export function hasInstrument(type: string): boolean {
  return REGISTRY.has(type);
}

export const DEFAULT_INSTRUMENT = "subtractive";

/** The entry for a type, falling back to the default for unknown ids. */
export function catalogEntry(type: string): InstrumentInfo {
  return REGISTRY.get(type) ?? REGISTRY.get(DEFAULT_INSTRUMENT)!;
}

export function instrumentSchema(type: string): ParamSchema {
  return catalogEntry(type).schema;
}

/** Default group family for an instrument type (see InstrumentInfo.family). */
export function instrumentFamily(type: string): string {
  return catalogEntry(type).family;
}

// --- built-in instruments (self-registered) -------------------------------
registerInstrument({ type: "subtractive", label: "Subtractive", schema: subtractiveSchema, family: "Synths" });
registerInstrument({ type: "fm", label: "FM", schema: fmSchema, family: "Bass" });
registerInstrument({ type: "supersaw", label: "Supersaw", schema: supersawSchema, family: "Synths" });
registerInstrument({ type: "organ", label: "Organ", schema: organSchema, family: "Keys" });
registerInstrument({ type: "mellotron", label: "Mellotron Flute", schema: mellotronFluteSchema, family: "Keys" });
registerInstrument({ type: "wavetable", label: "Wavetable", schema: wavetableSchema, family: "Synths" });
registerInstrument({ type: "nimbus", label: "Nimbus", schema: nimbusSchema, family: "Synths" });
registerInstrument({ type: "sampler", label: "Sampler", schema: samplerSchema, family: "Percussion" });
registerInstrument({ type: "drumkit", label: "Drum Kit", schema: drumkitSchema, family: "Percussion" });
// The empty-track sentinel: no params, hidden from the palette, silent factory (registry.ts).
registerInstrument({ type: EMPTY_INSTRUMENT, label: "No instrument", schema: [], family: "main", hidden: true });
