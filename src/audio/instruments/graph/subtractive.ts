/**
 * Subtractive synth as a declarative voice graph: an oscillator through a resonant
 * lowpass, shaped by two envelopes. Its schema (subtractiveSchema) is the usual keystone,
 * so UI, MCP and persistence are projections of it; only the audio is built from this
 * data. The filter is per voice rather than one shared paraphonic filter, which is what
 * lets each note sweep its own cutoff.
 *
 * The voice shapes its own amplitude (wired to `out`, INST-12): `ampEnv` drives the VCA,
 * so the synth has a full ADSR rather than the base's attack/release. `filterEnv` sweeps
 * the cutoff through the filter's `detune`, so `filter.env` reads in semitones - 12 opens
 * it an octave at the envelope's peak, whatever the cutoff.
 */
import type { GraphInstrumentDef } from "../../graph/types";
import { subtractiveSchema } from "../catalog";

/** Cents per semitone, so `filter.env` can be authored in semitones and land on `detune`. */
const CENTS = 100;

export const subtractive: GraphInstrumentDef = {
  type: "subtractive",
  schema: subtractiveSchema,
  voice: {
    nodes: [
      { id: "osc", kind: "osc", waveform: { param: "osc.waveform" }, detune: { param: "osc.detune" } },
      {
        id: "filter",
        kind: "biquad",
        filterType: "lowpass",
        frequency: { param: "filter.cutoff" },
        q: { param: "filter.resonance" },
      },
      {
        id: "filterEnv",
        kind: "env",
        attack: { param: "fenv.attack" },
        decay: { param: "fenv.decay" },
        sustain: { param: "fenv.sustain" },
        release: { param: "fenv.release" },
      },
      { id: "filterEnvDepth", kind: "gain", gain: { param: "filter.env", scale: CENTS } },
      {
        id: "ampEnv",
        kind: "env",
        attack: { param: "env.attack" },
        decay: { param: "env.decay" },
        sustain: { param: "env.sustain" },
        release: { param: "env.release" },
      },
      { id: "vca", kind: "gain", gain: 0 }, // silent until the envelope opens it
    ],
    connections: [
      ["osc", "filter"],
      ["filter", "vca"],
      ["filterEnv", "filterEnvDepth"],
      ["filterEnvDepth", "filter.detune"],
      ["ampEnv", "vca.gain"],
      ["vca", "out"], // out = the voice as-is (velocity only); the envelopes above shape it
    ],
  },
};
