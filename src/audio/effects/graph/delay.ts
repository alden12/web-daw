/**
 * Feedback delay as a declarative graph: in -> delay -> wet, with delay -> feedback ->
 * delay for the repeats. Reuses delaySchema; the uniform `mix` crossfade is handled by
 * BaseEffect via the reserved `wet` bus. Shows a feedback loop in the format.
 */
import type { GraphEffectDef } from "../../graph/types";
import { delaySchema } from "../catalog";

export const delay: GraphEffectDef = {
  type: "delay",
  schema: delaySchema,
  graph: {
    nodes: [
      { id: "delay", kind: "delay", maxSeconds: 2, delayTime: { param: "delay.time" } },
      { id: "feedback", kind: "gain", gain: { param: "delay.feedback" } },
    ],
    connections: [
      ["in", "delay"],
      ["delay", "feedback"],
      ["feedback", "delay"],
      ["delay", "wet"],
    ],
  },
};
