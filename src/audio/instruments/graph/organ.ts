/**
 * Additive organ as a declarative voice graph (INST-17): six sine partials at 1..6 times the
 * note, summed into the voice amp, like a drawbar organ. `organ.brightness` rolls the upper
 * partials in or out: partial h is weighted brightness^(h-1), normalised by the sum of the
 * weights, from a mellow fundamental to a bright, reedy tone.
 *
 * That weighting is not a straight line in brightness, so each partial's level is read off a
 * lookup table sampled from the formula (`tableOf`). 21 points across 0..1 keep every level
 * within about 1% of it.
 */
import type { GraphInstrumentDef, NodeSpec } from "../../graph/types";
import { tableOf } from "../../graph/table";
import { organSchema } from "../catalog";

export const ORGAN_HARMONICS = [1, 2, 3, 4, 5, 6];

/** Partial `harmonic`'s share of the voice at a brightness: its weight over the sum of all. */
export const organPartialLevel = (harmonic: number, brightness: number): number => {
  const weights = ORGAN_HARMONICS.map((each) => Math.pow(brightness, each - 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights[harmonic - 1] / total;
};

export const organ: GraphInstrumentDef = {
  type: "organ",
  schema: organSchema,
  voice: {
    nodes: ORGAN_HARMONICS.flatMap((harmonic): NodeSpec[] => [
      { id: `partial${harmonic}`, kind: "osc", waveform: "sine", noteRatio: harmonic },
      {
        id: `level${harmonic}`,
        kind: "gain",
        gain: {
          param: "organ.brightness",
          table: tableOf((brightness) => organPartialLevel(harmonic, brightness), 0, 1, 21),
        },
      },
    ]),
    connections: ORGAN_HARMONICS.flatMap((harmonic): [string, string][] => [
      [`partial${harmonic}`, `level${harmonic}`],
      [`level${harmonic}`, "amp"],
    ]),
  },
};
