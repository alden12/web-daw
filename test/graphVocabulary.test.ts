/**
 * The native-node vocabulary INST-13 added - noise, constant, pan, compressor, convolver, and more
 * waveshaper curves - as an author meets it: what a def may say, and what the curves do.
 */
import { describe, expect, it } from "vitest";
import { SHAPER_CURVES } from "../src/audio/graph/nodes";
import { validateGraph, INSTRUMENT_RESERVED, EFFECT_RESERVED } from "../src/audio/graph/validate";
import { parseEffectDef, parseInstrumentDef } from "../src/audio/graph/zod";
import { SHAPER_SHAPES } from "../src/audio/graph/types";
import type { Graph } from "../src/audio/graph/types";

/** A curve's output at input x (-1..1), read off its 1024 points. */
const at = (curve: Float32Array, x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

describe("waveshaper curves", () => {
  it("every family stays within full scale and passes silence as silence", () => {
    for (const shape of SHAPER_SHAPES) {
      const curve = SHAPER_CURVES[shape](50);
      expect(Math.max(...curve.map(Math.abs))).toBeLessThanOrEqual(1.0001);
      expect(Math.abs(at(curve, 0))).toBeLessThan(0.01);
    }
  });

  it("hardClip flattens at full scale, where tanh is still curving", () => {
    const clipped = SHAPER_CURVES.hardClip(50);
    const saturated = SHAPER_CURVES.tanh(5);
    expect(at(clipped, 0.5)).toBe(1);
    expect(at(saturated, 0.5)).toBeLessThan(1);
    expect(at(saturated, 0.5)).toBeGreaterThan(0.5);
  });

  it("fold turns back down past full scale instead of holding there", () => {
    const folded = SHAPER_CURVES.fold(100);
    expect(Math.abs(at(folded, 0.9))).toBeLessThan(Math.max(...folded.map(Math.abs)));
  });
});

const snare: Graph = {
  nodes: [
    { id: "noise", kind: "noise", color: "white" },
    { id: "band", kind: "biquad", filterType: "bandpass", frequency: 1800 },
    { id: "env", kind: "env", attack: 1, decay: 120, sustain: 0 },
    { id: "vca", kind: "gain", gain: 0 },
    { id: "place", kind: "pan", pan: 0.2 },
  ],
  connections: [
    ["noise", "band"],
    ["band", "vca"],
    ["env", "vca.gain"],
    ["vca", "place"],
    ["place", "out"],
  ],
};

describe("authoring with the new nodes", () => {
  it("a snare is noise through a band-pass, enveloped and placed", () => {
    expect(validateGraph([], snare, INSTRUMENT_RESERVED)).toEqual([]);
    expect(parseInstrumentDef({ type: "ci-snare", schema: [], voice: snare }).ok).toBe(true);
  });

  it("a reverb and a compressor are effect nodes, with the compressor's settings modulatable", () => {
    const graph: Graph = {
      nodes: [
        { id: "squash", kind: "compressor", threshold: -24, ratio: 4, attack: 0.003, release: 0.25 },
        { id: "room", kind: "convolver", impulse: { shape: "decay", seconds: 1.5 } },
        { id: "wobble", kind: "osc", frequency: 0.5 },
      ],
      connections: [
        ["in", "squash"],
        ["squash", "room"],
        ["room", "wet"],
        ["wobble", "squash.threshold"],
      ],
    };
    expect(validateGraph([], graph, EFFECT_RESERVED)).toEqual([]);
    expect(parseEffectDef({ type: "ce-1", schema: [], graph }).ok).toBe(true);
  });

  it("refuses a colour, curve or impulse it does not have, rather than failing when played", () => {
    const withNode = (node: unknown) => ({ type: "ce-1", schema: [], graph: { nodes: [node], connections: [] } });
    expect(parseEffectDef(withNode({ id: "n", kind: "noise", color: "brown" })).ok).toBe(false);
    expect(parseEffectDef(withNode({ id: "s", kind: "shaper", curve: { shape: "fuzz", amount: 1 } })).ok).toBe(false);
    expect(
      parseEffectDef(withNode({ id: "c", kind: "convolver", impulse: { shape: "cathedral", seconds: 2 } })).ok,
    ).toBe(false);
  });

  it("a constant's offset and a pan's position are modulation targets; a convolver has none", () => {
    const graph = (to: string): Graph => ({
      nodes: [
        { id: "lfo", kind: "osc", frequency: 1 },
        { id: "base", kind: "constant", offset: 1 },
        { id: "place", kind: "pan" },
        { id: "room", kind: "convolver", impulse: { shape: "decay", seconds: 1 } },
      ],
      connections: [["lfo", to]],
    });
    expect(validateGraph([], graph("base.offset"), EFFECT_RESERVED)).toEqual([]);
    expect(validateGraph([], graph("place.pan"), EFFECT_RESERVED)).toEqual([]);
    expect(validateGraph([], graph("room.buffer"), EFFECT_RESERVED)).toHaveLength(1);
  });
});

describe("the buffer node", () => {
  const voice = (node: Record<string, unknown>) => ({
    type: "ci-1",
    schema: [
      { id: "kit.sample", label: "Sample", kind: "sample", default: "builtin:kick" },
      { id: "kit.keytrack", label: "Keytrack", kind: "boolean", default: true },
    ],
    voice: { nodes: [{ id: "hit", kind: "buffer", ...node }], connections: [["hit", "amp"]] },
  });

  it("takes a sample ref, or a sample param, and switches bound to params", () => {
    expect(parseInstrumentDef(voice({ sample: "builtin:snare" })).ok).toBe(true);
    expect(
      parseInstrumentDef(
        voice({ sample: { param: "kit.sample" }, keytrack: { param: "kit.keytrack" }, oneShot: false }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a switch that is not a switch, and a buffer without a sample", () => {
    expect(parseInstrumentDef(voice({ sample: "builtin:kick", oneShot: "yes" })).ok).toBe(false);
    expect(parseInstrumentDef(voice({})).ok).toBe(false);
  });

  it("is instruments only, since it plays per note", () => {
    const graph: Graph = {
      nodes: [{ id: "hit", kind: "buffer", sample: "builtin:kick" }],
      connections: [["in", "wet"]],
    };
    expect(validateGraph([], graph, EFFECT_RESERVED)).toEqual(['node "hit": buffer only works in an instrument voice']);
  });
});
