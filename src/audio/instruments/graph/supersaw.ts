/**
 * Supersaw as a declarative voice graph (INST-17): a stack of detuned sawtooth oscillators summed
 * into one voice for a thick, wide unison lead or pad. `super.voices` sets how many saws sound,
 * `super.detune` spreads them evenly across +/- that many cents around the note.
 *
 * A graph has a fixed node list and the count is a live knob, so every voice builds all nine
 * saws and silences the ones past the count. Two lookup tables over `super.voices` do the work:
 * - saw k's level: 1/n while the count n reaches k (loudness stays even as saws are added), else 0;
 * - saw k's place in the spread, from -1 to +1. Its detune is that place times `super.detune`,
 *   a product of two params, which a binding cannot say; a constant at the place, through a gain
 *   set to the spread, into the saw's detune, can.
 * Both are live, so turning either knob reaches notes already held.
 */
import type { GraphInstrumentDef, NodeSpec, TablePoint } from "../../graph/types";
import { supersawSchema } from "../catalog";

export const SUPERSAW_MAX = 9;
const SAWS = Array.from({ length: SUPERSAW_MAX }, (_unused, index) => index + 1);

/** Saw `saw`'s level with `count` saws sounding: an even share, or silent past the count. */
export const supersawLevel = (saw: number, count: number): number => (saw <= count ? 1 / count : 0);

/** Saw `saw`'s place across the spread with `count` sounding: -1 (lowest) to +1 (highest). */
export const supersawPlace = (saw: number, count: number): number =>
  count === 1 || saw > count ? 0 : -1 + (2 * (saw - 1)) / (count - 1);

/** One point per whole count: the value for that many saws. */
const perCount = (value: (count: number) => number): TablePoint[] => SAWS.map((count) => [count, value(count)]);

export const supersaw: GraphInstrumentDef = {
  type: "supersaw",
  schema: supersawSchema,
  voice: {
    nodes: SAWS.flatMap((saw): NodeSpec[] => [
      { id: `saw${saw}`, kind: "osc", waveform: "sawtooth" },
      {
        id: `level${saw}`,
        kind: "gain",
        gain: { param: "super.voices", table: perCount((count) => supersawLevel(saw, count)) },
      },
      {
        id: `place${saw}`,
        kind: "constant",
        offset: { param: "super.voices", table: perCount((count) => supersawPlace(saw, count)) },
      },
      { id: `spread${saw}`, kind: "gain", gain: { param: "super.detune" } },
    ]),
    connections: SAWS.flatMap((saw): [string, string][] => [
      [`saw${saw}`, `level${saw}`],
      [`level${saw}`, "amp"],
      [`place${saw}`, `spread${saw}`],
      [`spread${saw}`, `saw${saw}.detune`],
    ]),
  },
};
