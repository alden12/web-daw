/**
 * Mellotron Flute as a declarative voice graph: the warm, breathy tape-flute of the
 * Strawberry Fields intro. Two triangle oscillators are spread apart by `tone.spread`
 * (one -half, one +half the cents) for the tape-chorus shimmer; a unison sine adds
 * `body`; a single sine LFO at `vibrato.rate` fans into every oscillator's detune for a
 * coherent wobble; a gentle lowpass (`tone.warmth`) keeps it mellow. Reuses
 * mellotronFluteSchema, so UI/MCP/automation/persistence are the usual projections.
 */
import type { GraphInstrumentDef } from "../../graph/types";
import { mellotronFluteSchema } from "../catalog";

export const mellotronFlute: GraphInstrumentDef = {
  type: "mellotron",
  schema: mellotronFluteSchema,
  voice: {
    nodes: [
      // Two triangles detuned apart -> the tape chorus. The LFO adds vibrato on top.
      { id: "osc1", kind: "osc", waveform: "triangle", detune: { param: "tone.spread", scale: -0.5 } },
      { id: "osc2", kind: "osc", waveform: "triangle", detune: { param: "tone.spread", scale: 0.5 } },
      { id: "body", kind: "osc", waveform: "sine" }, // unison sine for fundamental weight
      { id: "g1", kind: "gain", gain: 0.4 },
      { id: "g2", kind: "gain", gain: 0.4 },
      { id: "gBody", kind: "gain", gain: { param: "body.level" } },
      { id: "lfo", kind: "osc", waveform: "sine", frequency: { param: "vibrato.rate" } }, // absolute Hz
      { id: "lfoDepth", kind: "gain", gain: { param: "vibrato.depth" } }, // depth in cents
      { id: "warmth", kind: "biquad", filterType: "lowpass", frequency: { param: "tone.warmth" }, q: 0.7 },
    ],
    connections: [
      ["osc1", "g1"],
      ["osc2", "g2"],
      ["body", "gBody"],
      ["g1", "warmth"],
      ["g2", "warmth"],
      ["gBody", "warmth"],
      ["lfo", "lfoDepth"],
      ["lfoDepth", "osc1.detune"], // vibrato adds to each osc's intrinsic detune
      ["lfoDepth", "osc2.detune"],
      ["lfoDepth", "body.detune"],
      ["warmth", "amp"], // amp = the base's velocity + ADSR gain -> output
    ],
  },
};
