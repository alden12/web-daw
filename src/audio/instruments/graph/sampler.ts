/**
 * The Sampler as a declarative voice graph: one sample, chosen by `sampler.sample`, pitched from
 * `sampler.root` when `sampler.keytrack` is on, through the base's attack/release envelope. A
 * one-shot, as the class version was: a hit plays out however short the note. Reuses samplerSchema,
 * so saved projects and patches are unchanged.
 *
 * One behaviour moved, for the better: the class played out a sample only when the sequencer
 * scheduled it, and cut it at note-off when played live. Now it plays out either way, and Stop
 * cuts it, which the class did not do for sequenced hits.
 */
import type { GraphInstrumentDef } from "../../graph/types";
import { samplerSchema } from "../catalog";

export const sampler: GraphInstrumentDef = {
  type: "sampler",
  schema: samplerSchema,
  voice: {
    nodes: [
      {
        id: "sample",
        kind: "buffer",
        sample: { param: "sampler.sample" },
        root: { param: "sampler.root" },
        keytrack: { param: "sampler.keytrack" },
        start: { param: "sampler.start" },
        oneShot: true,
      },
    ],
    connections: [["sample", "amp"]], // amp = the base's velocity + attack/release
  },
};
