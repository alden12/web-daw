/**
 * Lookup tables on a parameter binding (INST-17), and the two instruments they made graphs:
 * Organ and Supersaw. The old classes computed their levels and detunes directly; those formulas
 * are the oracle the defs' tables are checked against.
 */
import { describe, it, expect } from "vitest";
import { lookupTable, resolveNumber, tableOf, tableProblem } from "../src/audio/graph/table";
import { parseInstrumentDef } from "../src/audio/graph/zod";
import { validateGraph, INSTRUMENT_RESERVED } from "../src/audio/graph/validate";
import type { GainNodeSpec, ConstantNodeSpec, NumberRef, TablePoint } from "../src/audio/graph/types";
import { organ, organPartialLevel, ORGAN_HARMONICS } from "../src/audio/instruments/graph/organ";
import { supersaw, supersawLevel, supersawPlace, SUPERSAW_MAX } from "../src/audio/instruments/graph/supersaw";

describe("lookupTable", () => {
  const points: TablePoint[] = [
    [0, 10],
    [1, 20],
    [3, 0],
  ];
  it("reads a straight line between points", () => {
    expect(lookupTable(points, 0.5)).toBe(15);
    expect(lookupTable(points, 2)).toBe(10);
  });
  it("hits each point exactly", () => {
    expect(points.map(([input]) => lookupTable(points, input))).toEqual([10, 20, 0]);
  });
  it("holds the end values beyond the table", () => {
    expect(lookupTable(points, -5)).toBe(10);
    expect(lookupTable(points, 99)).toBe(0);
  });
});

describe("resolveNumber", () => {
  it("reads the table first, then scales and offsets", () => {
    const ref = {
      table: [
        [0, 0],
        [1, 2],
      ] as TablePoint[],
      scale: 10,
      offset: 1,
    };
    expect(resolveNumber(0.5, ref)).toBe(11);
  });
});

describe("table validation", () => {
  it("wants two points or more, with inputs ascending", () => {
    expect(tableProblem([[0, 1]])).toMatch(/two points/);
    expect(
      tableProblem([
        [1, 0],
        [0, 1],
      ]),
    ).toMatch(/ascending/);
    expect(
      tableProblem([
        [0, 0],
        [0, 1],
      ]),
    ).toMatch(/ascending/);
    expect(tableProblem(tableOf((input) => input * input, 0, 1, 5))).toBeNull();
  });

  const defWith = (table: unknown) => ({
    type: "tabled",
    label: "Tabled",
    schema: [{ id: "tone", label: "Tone", kind: "number", min: 0, max: 1, default: 0.5 }],
    voice: {
      nodes: [
        { id: "osc", kind: "osc" },
        { id: "level", kind: "gain", gain: { param: "tone", table } },
      ],
      connections: [
        ["osc", "level"],
        ["level", "amp"],
      ],
    },
  });

  it("lets an agent's def bind a number through a table", () => {
    expect(
      parseInstrumentDef(
        defWith([
          [0, 0],
          [1, 1],
        ]),
      ).ok,
    ).toBe(true);
  });

  it("refuses a table out of order, with the reason", () => {
    const result = parseInstrumentDef(
      defWith([
        [1, 0],
        [0, 1],
      ]),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toMatch(/ascending/);
  });

  it("refuses a table on a field that is not a number", () => {
    const def = defWith(undefined);
    def.voice.nodes[0] = {
      id: "osc",
      kind: "osc",
      waveform: {
        param: "tone",
        table: [
          [0, 0],
          [1, 1],
        ],
      },
    } as never;
    expect(parseInstrumentDef(def).ok).toBe(false);
  });
});

/** A node's bound number field, by node id and field name. */
const boundField = (nodes: readonly unknown[], id: string, field: "gain" | "offset"): NumberRef => {
  const node = nodes.find((each) => (each as { id: string }).id === id) as GainNodeSpec & ConstantNodeSpec;
  return node[field] as NumberRef;
};

describe("Organ as a graph", () => {
  it("is a valid def", () => {
    expect(validateGraph(organ.schema, organ.voice, INSTRUMENT_RESERVED)).toEqual([]);
    expect(parseInstrumentDef(organ).ok).toBe(true);
  });

  it("weights each partial as the class did, within 1% of the voice across the brightness range", () => {
    const brightnesses = Array.from({ length: 101 }, (_unused, index) => index / 100);
    for (const harmonic of ORGAN_HARMONICS) {
      const level = boundField(organ.voice.nodes, `level${harmonic}`, "gain");
      for (const brightness of brightnesses) {
        expect(Math.abs(resolveNumber(brightness, level) - organPartialLevel(harmonic, brightness))).toBeLessThan(0.01);
      }
    }
  });

  it("is a pure fundamental at no brightness, and all partials equal at full", () => {
    expect(ORGAN_HARMONICS.map((harmonic) => organPartialLevel(harmonic, 0))).toEqual([1, 0, 0, 0, 0, 0]);
    expect(ORGAN_HARMONICS.map((harmonic) => organPartialLevel(harmonic, 1))).toEqual(Array(6).fill(1 / 6));
  });
});

describe("Supersaw as a graph", () => {
  const counts = Array.from({ length: SUPERSAW_MAX }, (_unused, index) => index + 1);
  const saws = counts;

  it("is a valid def", () => {
    expect(validateGraph(supersaw.schema, supersaw.voice, INSTRUMENT_RESERVED)).toEqual([]);
    expect(parseInstrumentDef(supersaw).ok).toBe(true);
  });

  it("sounds exactly the first n saws, at 1/n each, for every count", () => {
    for (const count of counts) {
      const levels = saws.map((saw) => resolveNumber(count, boundField(supersaw.voice.nodes, `level${saw}`, "gain")));
      expect(levels).toEqual(saws.map((saw) => (saw <= count ? 1 / count : 0)));
    }
  });

  it("spreads the sounding saws as the class did: evenly from -detune to +detune", () => {
    const spread = 25;
    for (const count of counts) {
      // What the class computed for saw i of n (0-based): -spread + 2*spread*i/(n-1), or 0 alone.
      const expected = Array.from({ length: count }, (_unused, index) =>
        count === 1 ? 0 : -spread + (2 * spread * index) / (count - 1),
      );
      const detunes = saws
        .slice(0, count)
        .map((saw) => resolveNumber(count, boundField(supersaw.voice.nodes, `place${saw}`, "offset")) * spread);
      detunes.forEach((detune, index) => expect(detune).toBeCloseTo(expected[index], 9));
    }
  });

  it("has the level and place helpers agree with the tables", () => {
    expect(supersawLevel(3, 2)).toBe(0);
    expect(supersawPlace(1, 1)).toBe(0);
    expect(supersawPlace(1, 3)).toBe(-1);
    expect(supersawPlace(3, 3)).toBe(1);
  });
});
