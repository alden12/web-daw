/**
 * 2-operator FM synth as a declarative voice graph: a modulator oscillator drives the
 * carrier's frequency (modulator -> modGain -> carrier.frequency), carrier -> amp.
 * `fm.ratio` sets the modulator:carrier frequency ratio; `fm.index` the depth in Hz.
 * Reuses the existing fmSchema. Shows modulation into an AudioParam (`carrier.frequency`)
 * and a note-relative oscillator frequency (`noteRatio`).
 */
import type { GraphInstrumentDef } from "../../graph/types";
import { fmSchema } from "../catalog";

export const fm: GraphInstrumentDef = {
  type: "fm",
  schema: fmSchema,
  voice: {
    nodes: [
      { id: "carrier", kind: "osc" }, // tracks the note
      { id: "mod", kind: "osc", noteRatio: { param: "fm.ratio" } }, // note * ratio
      { id: "modGain", kind: "gain", gain: { param: "fm.index" } }, // depth in Hz
    ],
    connections: [
      ["mod", "modGain"],
      ["modGain", "carrier.frequency"], // "-> node.param" modulates that AudioParam
      ["carrier", "amp"],
    ],
  },
};
