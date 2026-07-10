/**
 * Waveshaper distortion as a declarative graph: in -> shaper -> tone (lowpass) -> wet.
 * `dist.drive` sets the curve amount (the `classic` family is the exact curve from the
 * original effect), `dist.tone` tames the high end. Reuses distortionSchema; `mix` by
 * BaseEffect. Shows a parameterized curve primitive.
 */
import type { GraphEffectDef } from "../../graph/types";
import { distortionSchema } from "../catalog";

export const distortion: GraphEffectDef = {
  type: "distortion",
  schema: distortionSchema,
  graph: {
    nodes: [
      { id: "shaper", kind: "shaper", oversample: "4x", curve: { shape: "classic", amount: { param: "dist.drive" } } },
      { id: "tone", kind: "biquad", filterType: "lowpass", frequency: { param: "dist.tone" } },
    ],
    connections: [
      ["in", "shaper"],
      ["shaper", "tone"],
      ["tone", "wet"],
    ],
  },
};
