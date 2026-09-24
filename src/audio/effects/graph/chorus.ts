/**
 * Chorus as a declarative graph: a short delay whose time an LFO sways, so the delayed copy drifts
 * in pitch against the dry signal. The delay sits at 25ms and swings up to 10ms either way at full
 * `chorus.depth`, exactly as the class version did; `mix` by BaseEffect.
 */
import type { GraphEffectDef } from "../../graph/types";
import { chorusSchema } from "../catalog";

/** The delay the LFO swings around, and the furthest it swings, in seconds. */
const BASE_DELAY = 0.025;
const MAX_SWING = 0.01;

export const chorus: GraphEffectDef = {
  type: "chorus",
  schema: chorusSchema,
  graph: {
    nodes: [
      { id: "delay", kind: "delay", maxSeconds: BASE_DELAY + MAX_SWING + 0.05, delayTime: BASE_DELAY },
      { id: "lfo", kind: "osc", waveform: "sine", frequency: { param: "chorus.rate" } },
      { id: "lfoDepth", kind: "gain", gain: { param: "chorus.depth", scale: MAX_SWING } },
    ],
    connections: [
      ["in", "delay"],
      ["delay", "wet"],
      ["lfo", "lfoDepth"],
      ["lfoDepth", "delay.delayTime"],
    ],
  },
};
