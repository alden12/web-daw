import { describe, it, expect } from "vitest";
import { buildBanks, buildTables, sampleOne, sampleTable, TABLE_SIZE } from "../src/audio/dsp/wavetable";
import { WAVETABLE_BANKS } from "../src/audio/graph/types";

describe("buildTables", () => {
  it("builds a bank of normalized single-cycle tables", () => {
    const tables = buildTables();
    expect(tables.length).toBe(4);
    for (const table of tables) {
      expect(table.length).toBe(TABLE_SIZE);
      const peak = Math.max(...Array.from(table, Math.abs));
      expect(peak).toBeCloseTo(1, 5); // normalized to full scale
    }
  });

  it("the first table is a sine (zero at phase 0, peak near phase 0.25)", () => {
    const [sine] = buildTables();
    expect(sampleOne(sine, 0)).toBeCloseTo(0, 6);
    expect(sampleOne(sine, 0.25)).toBeCloseTo(1, 3);
    expect(sampleOne(sine, 0.5)).toBeCloseTo(0, 3);
  });
});

describe("sampleOne", () => {
  it("linearly interpolates between samples", () => {
    const table = new Float32Array([0, 1, 0, -1]); // length 4
    expect(sampleOne(table, 0)).toBe(0);
    expect(sampleOne(table, 0.125)).toBeCloseTo(0.5); // halfway between index 0 and 1
    expect(sampleOne(table, 0.25)).toBe(1);
  });

  it("wraps the phase into [0, 1)", () => {
    const table = new Float32Array([0, 1, 0, -1]);
    expect(sampleOne(table, 1)).toBeCloseTo(sampleOne(table, 0));
    expect(sampleOne(table, 1.25)).toBeCloseTo(sampleOne(table, 0.25));
  });
});

describe("sampleTable (morph)", () => {
  const a = new Float32Array([0, 1, 0, -1]);
  const b = new Float32Array([1, 1, 1, 1]);

  it("position 0 / 1 select the end tables", () => {
    expect(sampleTable([a, b], 0, 0.25)).toBeCloseTo(sampleOne(a, 0.25));
    expect(sampleTable([a, b], 1, 0.25)).toBeCloseTo(sampleOne(b, 0.25));
  });

  it("a middle position crossfades the two tables", () => {
    const mid = sampleTable([a, b], 0.5, 0.0); // a=0, b=1 -> 0.5
    expect(mid).toBeCloseTo(0.5);
  });

  it("clamps out-of-range position and handles a single / empty bank", () => {
    expect(sampleTable([a, b], 2, 0.25)).toBeCloseTo(sampleOne(b, 0.25));
    expect(sampleTable([a], 0.7, 0.25)).toBeCloseTo(sampleOne(a, 0.25));
    expect(sampleTable([], 0.5, 0.5)).toBe(0);
  });
});

describe("buildBanks (the graph's wavetableOsc banks)", () => {
  const banks = buildBanks();
  /** One table's strength at harmonic k (a single DFT bin over its one cycle). */
  const harmonic = (table: Float32Array, k: number) =>
    Math.abs(table.reduce((sum, value, index) => sum + value * Math.sin((2 * Math.PI * k * index) / table.length), 0)) /
    (table.length / 2);

  it("has a bank per name, in order, each table normalised to a peak of 1", () => {
    expect(banks).toHaveLength(WAVETABLE_BANKS.length);
    for (const table of banks.flat()) {
      expect(table).toHaveLength(TABLE_SIZE);
      expect(Math.max(...table.map(Math.abs))).toBeCloseTo(1, 5);
    }
  });

  it("classic is the Wavetable instrument's bank", () => {
    expect(banks[WAVETABLE_BANKS.indexOf("classic")]).toEqual(buildTables());
  });

  it("harmonics pulls in more equal harmonics as it goes", () => {
    const [first, , , , last] = banks[WAVETABLE_BANKS.indexOf("harmonics")];
    expect(harmonic(first, 2)).toBeLessThan(0.001);
    expect(harmonic(last, 16) / harmonic(last, 1)).toBeCloseTo(1, 2);
  });

  it("pulse narrows from a square (no even harmonics) to a thin pulse (strong ones)", () => {
    const tables = banks[WAVETABLE_BANKS.indexOf("pulse")];
    const [square, thin] = [tables[0], tables[tables.length - 1]];
    expect(harmonic(square, 2)).toBeLessThan(0.001);
    expect(harmonic(thin, 2) / harmonic(thin, 1)).toBeGreaterThan(0.9);
  });
});
