/**
 * The Drum Kit as a declarative voice graph: one `buffer` per pad, each sounding only on its own
 * `pad<N>.note`, through its `pad<N>.level` into the base's short attack/release. Generated from
 * `DRUMKIT_PADS`, as the pad params are, so more pads is raising that number.
 *
 * The graph holds no samples: pad N plays whatever `pad<N>.sample` names. Which sounds a kit has is
 * data - the defaults are the built-in kit on the GM drum map, and a patch can be any other - which
 * is what lets kits become swappable presets (INST-16).
 *
 * Pads are one-shots at their tune (cents from `pad<N>.tune` semitones), never keytracked: a note
 * picks a pad rather than a pitch. Only the hit pad's nodes are built per note (prune.ts). Two pads
 * on the same note now both sound, layered, where the class version played the first.
 */
import type { GraphInstrumentDef, NodeSpec, Connection } from "../../graph/types";
import { drumkitSchema, DRUMKIT_PADS } from "../catalog";

/** Cents in a semitone, so `pad<N>.tune` can stay in semitones and land on the buffer's `detune`. */
const CENTS = 100;

const pads = Array.from({ length: DRUMKIT_PADS }, (_unused, index) => index + 1);

const padNodes = (pad: number): NodeSpec[] => [
  {
    id: `pad${pad}`,
    kind: "buffer",
    sample: { param: `pad${pad}.sample` },
    note: { param: `pad${pad}.note` },
    detune: { param: `pad${pad}.tune`, scale: CENTS },
    keytrack: false,
    oneShot: true,
  },
  { id: `pad${pad}Level`, kind: "gain", gain: { param: `pad${pad}.level` } },
];

const padConnections = (pad: number): Connection[] => [
  [`pad${pad}`, `pad${pad}Level`],
  [`pad${pad}Level`, "amp"], // amp = the base's velocity + attack/release
];

export const drumkit: GraphInstrumentDef = {
  type: "drumkit",
  schema: drumkitSchema,
  voice: { nodes: pads.flatMap(padNodes), connections: pads.flatMap(padConnections) },
};
