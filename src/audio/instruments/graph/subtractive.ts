/**
 * Subtractive synth as a declarative voice graph: an oscillator through a resonant
 * lowpass into the enveloped amp. Reuses the existing subtractiveSchema, so the UI,
 * MCP, and persistence are identical to the class version - only the audio is built
 * from this data. (The filter is per-voice here rather than one shared paraphonic
 * filter; for a static lowpass that sums identically, so it sounds the same.)
 */
import type { GraphInstrumentDef } from "../../graph/types";
import { subtractiveSchema } from "../catalog";

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
    ],
    connections: [
      ["osc", "filter"],
      ["filter", "amp"], // amp = the base's velocity + ADSR gain -> output
    ],
  },
};
