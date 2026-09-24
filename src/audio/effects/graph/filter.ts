/**
 * Filter as a declarative graph: a resonant lowpass whose cutoff an LFO sweeps. The sweep goes
 * through the filter's `detune`, so `lfo.depth` is in octaves - full depth swings the cutoff an
 * octave either side, whatever it is set to. The class version swung it by a fraction of the
 * cutoff in Hz, which a graph cannot express (it would multiply two params); the octave sweep is
 * close at the default depth and even at every cutoff, which the Hz one was not. `mix` by BaseEffect.
 */
import type { GraphEffectDef } from "../../graph/types";
import { filterSchema } from "../catalog";

/** Cents in an octave: the sweep at full `lfo.depth`, either side of the cutoff. */
const OCTAVE_CENTS = 1200;

export const filter: GraphEffectDef = {
  type: "filter",
  schema: filterSchema,
  graph: {
    nodes: [
      {
        id: "filter",
        kind: "biquad",
        filterType: "lowpass",
        frequency: { param: "filter.cutoff" },
        q: { param: "filter.resonance" },
      },
      { id: "lfo", kind: "osc", waveform: "sine", frequency: { param: "lfo.rate" } },
      { id: "lfoDepth", kind: "gain", gain: { param: "lfo.depth", scale: OCTAVE_CENTS } },
    ],
    connections: [
      ["in", "filter"],
      ["filter", "wet"],
      ["lfo", "lfoDepth"],
      ["lfoDepth", "filter.detune"],
    ],
  },
};
