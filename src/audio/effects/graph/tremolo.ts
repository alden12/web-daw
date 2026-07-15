/**
 * Tremolo as a declarative graph: an LFO modulates a VCA's gain. in -> vca -> wet,
 * with lfo -> lfoDepth -> vca.gain. The gain rides between 1-depth and 1: the VCA base
 * is `1 - depth/2` and the LFO swings it by `depth/2` (both via scale/offset on the one
 * `tremolo.depth` param). Reuses tremoloSchema; `mix` by BaseEffect. Shows LFO
 * modulation into an AudioParam with linear transforms.
 */
import type { GraphEffectDef } from "../../graph/types";
import { tremoloSchema } from "../catalog";

export const tremolo: GraphEffectDef = {
  type: "tremolo",
  schema: tremoloSchema,
  graph: {
    nodes: [
      { id: "vca", kind: "gain", gain: { param: "tremolo.depth", scale: -0.5, offset: 1 } }, // 1 - depth/2
      { id: "lfo", kind: "osc", waveform: "sine", frequency: { param: "tremolo.rate" } },
      { id: "lfoDepth", kind: "gain", gain: { param: "tremolo.depth", scale: 0.5 } }, // depth/2
    ],
    connections: [
      ["in", "vca"],
      ["vca", "wet"],
      ["lfo", "lfoDepth"],
      ["lfoDepth", "vca.gain"],
    ],
  },
};
