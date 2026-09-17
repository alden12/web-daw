import { describe, expect, it } from "vitest";
import {
  quantizeBeat,
  quantizeNotes,
  beatsForGrid,
  GRID_DIVISIONS,
  FINEST_DIVISION,
} from "../src/audio/sequencer/quantize";
import type { NoteEvent } from "../src/audio/sequencer/types";

const note = (over: Partial<NoteEvent> = {}): NoteEvent => ({
  id: "n",
  pitch: 60,
  start: 0,
  length: 1,
  velocity: 0.8,
  ...over,
});

describe("quantizeBeat", () => {
  it("snaps fully at strength 1", () => {
    expect(quantizeBeat(1.1, 0.25, 1)).toBeCloseTo(1.0);
    expect(quantizeBeat(1.13, 0.25, 1)).toBeCloseTo(1.25); // nearest line, not floor
  });

  it("is a no-op at strength 0", () => {
    expect(quantizeBeat(1.1, 0.25, 0)).toBe(1.1);
  });

  it("pulls halfway at strength 0.5", () => {
    // nearest grid line of 1.1 (grid 1) is 1.0; halfway from 1.1 -> 1.05
    expect(quantizeBeat(1.1, 1, 0.5)).toBeCloseTo(1.05);
  });

  it("supports triplet grids", () => {
    // a 1/8 triplet is 1/3 beat; 0.35 snaps to 1/3
    expect(quantizeBeat(0.35, 1 / 3, 1)).toBeCloseTo(1 / 3);
  });
});

describe("quantizeNotes", () => {
  it("moves starts only by default, leaving lengths untouched", () => {
    const [out] = quantizeNotes([note({ start: 1.1, length: 0.9 })], { gridBeats: 0.25, strength: 1, ends: false });
    expect(out.start).toBeCloseTo(1.0);
    expect(out.length).toBe(0.9);
  });

  it("snaps ends too when ends=true, flooring length to a 16th", () => {
    const [out] = quantizeNotes([note({ start: 1.08, length: 0.5 })], { gridBeats: 0.25, strength: 1, ends: true });
    expect(out.start).toBeCloseTo(1.0);
    expect(out.length).toBeCloseTo(0.5); // end 1.58 -> 1.5, length 1.5 - 1.0
  });

  it("never moves a start below zero", () => {
    const [out] = quantizeNotes([note({ start: 0.05 })], { gridBeats: 0.25, strength: 1, ends: false });
    expect(out.start).toBeGreaterThanOrEqual(0);
  });

  it("does not mutate the input notes", () => {
    const input = note({ start: 1.1 });
    quantizeNotes([input], { gridBeats: 0.25, strength: 1, ends: false });
    expect(input.start).toBe(1.1);
  });
});

describe("GRID_DIVISIONS", () => {
  it("includes triplets and exposes the finest division", () => {
    expect(GRID_DIVISIONS.map((d) => d.label)).toContain("1/16T");
    expect(FINEST_DIVISION).toBeCloseTo(1 / 6);
  });

  it("maps labels back to beats", () => {
    expect(beatsForGrid("1/8")).toBe(0.5);
    expect(beatsForGrid("1/8T")).toBeCloseTo(1 / 3);
    expect(beatsForGrid("nonsense")).toBe(0.25); // falls back to GRID
  });
});
