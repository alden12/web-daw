/**
 * Reverb as a declarative graph: the input through a convolver whose impulse is noise fading
 * over `reverb.decay` seconds, regenerated when the knob moves. The same generated tail the
 * class version used, so it sounds the same; `mix` by BaseEffect. Shows a composite field (the
 * impulse) bound to a param, as the distortion's curve is.
 */
import type { GraphEffectDef } from "../../graph/types";
import { reverbSchema } from "../catalog";

export const reverb: GraphEffectDef = {
  type: "reverb",
  schema: reverbSchema,
  graph: {
    nodes: [{ id: "room", kind: "convolver", impulse: { shape: "decay", seconds: { param: "reverb.decay" } } }],
    connections: [
      ["in", "room"],
      ["room", "wet"],
    ],
  },
};
