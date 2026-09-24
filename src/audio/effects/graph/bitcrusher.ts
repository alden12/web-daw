/**
 * Bitcrusher as a declarative graph (INST-15): in -> a `bitcrush` block -> wet. The block is the
 * same AudioWorklet the class wrapped (bitcrusher.worklet.ts over dsp/bitcrush.ts), now a node
 * kind any def can use. Reuses bitcrusherSchema; `mix` by BaseEffect.
 */
import type { GraphEffectDef } from "../../graph/types";
import { bitcrusherSchema } from "../catalog";

export const bitcrusher: GraphEffectDef = {
  type: "bitcrusher",
  schema: bitcrusherSchema,
  graph: {
    nodes: [{ id: "crush", kind: "bitcrush", bits: { param: "bits" }, downsample: { param: "downsample" } }],
    connections: [
      ["in", "crush"],
      ["crush", "wet"],
    ],
  },
};
