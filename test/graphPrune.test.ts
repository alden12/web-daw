/**
 * Pruning a voice graph to what a note plays (INST-13): a drum kit's other pads, and whatever only
 * they fed, are left out - and nothing that could be heard ever is.
 */
import { describe, expect, it } from "vitest";
import { pruneGraph } from "../src/audio/graph/prune";
import { drumkit } from "../src/audio/instruments/graph/drumkit";
import { validateGraph, INSTRUMENT_RESERVED } from "../src/audio/graph/validate";
import { DRUMKIT_PADS } from "../src/audio/instruments/catalog";
import type { Graph, NodeSpec } from "../src/audio/graph/types";

const ids = (graph: Graph) => graph.nodes.map((node) => node.id).sort();
const keepAll = () => true;

describe("pruneGraph", () => {
  it("leaves out a dropped pad and the level gain only it fed", () => {
    const kit: Graph = {
      nodes: [
        { id: "kick", kind: "buffer", sample: "builtin:kick" },
        { id: "kickLevel", kind: "gain" },
        { id: "snare", kind: "buffer", sample: "builtin:snare" },
        { id: "snareLevel", kind: "gain" },
      ],
      connections: [
        ["kick", "kickLevel"],
        ["kickLevel", "amp"],
        ["snare", "snareLevel"],
        ["snareLevel", "amp"],
      ],
    };
    const pruned = pruneGraph(kit, (node: NodeSpec) => node.id !== "snare", INSTRUMENT_RESERVED);
    expect(ids(pruned)).toEqual(["kick", "kickLevel"]);
    expect(pruned.connections).toEqual([
      ["kick", "kickLevel"],
      ["kickLevel", "amp"],
    ]);
  });

  it("follows a chain down, however long, but keeps a node still fed from elsewhere", () => {
    const chain: Graph = {
      nodes: [
        { id: "a", kind: "buffer", sample: "x" },
        { id: "b", kind: "buffer", sample: "y" },
        { id: "shared", kind: "gain" },
        { id: "onlyA", kind: "biquad" },
        { id: "afterOnlyA", kind: "gain" },
      ],
      connections: [
        ["a", "onlyA"],
        ["onlyA", "afterOnlyA"],
        ["a", "shared"],
        ["b", "shared"],
      ],
    };
    const pruned = pruneGraph(chain, (node) => node.id !== "a", INSTRUMENT_RESERVED);
    expect(ids(pruned)).toEqual(["b", "shared"]);
  });

  it("keeps sources, and anything fed by one, even with no path to the output", () => {
    const lfo: Graph = {
      nodes: [
        { id: "lfo", kind: "osc", frequency: 2 },
        { id: "depth", kind: "gain", gain: 5 },
        { id: "osc", kind: "osc" },
      ],
      connections: [
        ["lfo", "depth"],
        ["depth", "osc.detune"],
        ["osc", "amp"],
      ],
    };
    expect(pruneGraph(lfo, keepAll, INSTRUMENT_RESERVED)).toBe(lfo);
  });

  it("counts a reserved endpoint as an input, so an effect's chain from `in` stays", () => {
    const effect: Graph = {
      nodes: [{ id: "filter", kind: "biquad" }],
      connections: [
        ["in", "filter"],
        ["filter", "wet"],
      ],
    };
    expect(pruneGraph(effect, keepAll, ["in", "wet"])).toBe(effect);
  });

  it("does not count a modulation as an input: a gain with only its param driven makes silence", () => {
    const graph: Graph = {
      nodes: [
        { id: "lfo", kind: "osc", frequency: 2 },
        { id: "vca", kind: "gain" },
      ],
      connections: [
        ["lfo", "vca.gain"],
        ["vca", "amp"],
      ],
    };
    expect(ids(pruneGraph(graph, keepAll, INSTRUMENT_RESERVED))).toEqual(["lfo"]);
  });
});

describe("the Drum Kit graph", () => {
  it("validates, with a buffer and a level per pad", () => {
    expect(validateGraph(drumkit.schema, drumkit.voice, INSTRUMENT_RESERVED)).toEqual([]);
    expect(drumkit.voice.nodes.filter((node) => node.kind === "buffer")).toHaveLength(DRUMKIT_PADS);
  });

  it("builds only the hit pad's nodes", () => {
    const hit = pruneGraph(drumkit.voice, (node) => node.kind !== "buffer" || node.id === "pad2", INSTRUMENT_RESERVED);
    expect(ids(hit)).toEqual(["pad2", "pad2Level"]);
  });
});
