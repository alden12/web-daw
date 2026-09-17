import { describe, it, expect } from "vitest";
import { validateGraph, INSTRUMENT_RESERVED, EFFECT_RESERVED } from "../src/audio/graph/validate";
import { collectParamIds, resolveLinear } from "../src/audio/graph/build";
import { SHAPER_CURVES } from "../src/audio/graph/nodes";
import { subtractive } from "../src/audio/instruments/graph/subtractive";
import { fm } from "../src/audio/instruments/graph/fm";
import { mellotronFlute } from "../src/audio/instruments/graph/mellotronFlute";
import { delay } from "../src/audio/effects/graph/delay";
import { distortion } from "../src/audio/effects/graph/distortion";
import { tremolo } from "../src/audio/effects/graph/tremolo";

describe("validateGraph", () => {
  it("passes for every shipped instrument definition", () => {
    for (const def of [subtractive, fm, mellotronFlute]) {
      expect(validateGraph(def.schema, def.voice, INSTRUMENT_RESERVED)).toEqual([]);
    }
  });

  it("passes for every shipped effect definition", () => {
    for (const def of [delay, distortion, tremolo]) {
      expect(validateGraph(def.schema, def.graph, EFFECT_RESERVED)).toEqual([]);
    }
  });

  it("flags a binding to a parameter not in the schema", () => {
    const graph = { nodes: [{ id: "g", kind: "gain" as const, gain: { param: "does.not.exist" } }], connections: [] };
    const errors = validateGraph([], graph, EFFECT_RESERVED);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("does.not.exist");
  });

  it("flags a connection to an unknown node", () => {
    const errors = validateGraph(delay.schema, { ...delay.graph, connections: [["in", "ghost"]] }, EFFECT_RESERVED);
    expect(errors.some((error) => error.includes("ghost"))).toBe(true);
  });
});

describe("collectParamIds", () => {
  it("finds every parameter the graph binds (including nested noteRatio / curve)", () => {
    expect(collectParamIds(subtractive.voice).sort()).toEqual(
      ["filter.cutoff", "filter.resonance", "osc.detune", "osc.waveform"].sort(),
    );
    expect(collectParamIds(fm.voice).sort()).toEqual(["fm.index", "fm.ratio"].sort());
    expect(collectParamIds(distortion.graph)).toContain("dist.drive"); // nested in curve.amount
  });
});

describe("resolveLinear", () => {
  it("applies scale and offset with sensible defaults", () => {
    expect(resolveLinear(0.6, {})).toBe(0.6);
    expect(resolveLinear(0.6, { scale: 0.5 })).toBe(0.3); // tremolo LFO depth = depth/2
    expect(resolveLinear(0.6, { scale: -0.5, offset: 1 })).toBeCloseTo(0.7); // tremolo VCA base = 1 - depth/2
  });
});

describe("SHAPER_CURVES.classic", () => {
  it("matches the original distortion curve formula", () => {
    // The exact curve from the pre-graph Distortion effect, recomputed here as the oracle.
    const original = (amount: number): Float32Array => {
      const length = 1024;
      const curve = new Float32Array(length);
      const deg = Math.PI / 180;
      for (let index = 0; index < length; index++) {
        const x = (index * 2) / length - 1;
        curve[index] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    };
    const amount = 20;
    const ours = SHAPER_CURVES.classic(amount);
    const oracle = original(amount);
    expect(ours.length).toBe(oracle.length);
    for (const index of [0, 1, 256, 512, 900, 1023]) {
      expect(ours[index]).toBeCloseTo(oracle[index], 10);
    }
  });
});
