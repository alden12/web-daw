import { describe, expect, it } from "vitest";
import { beatToX, xToBeat, snapBeat, floorBeat, beatTicks, snapDelta } from "../src/ui/timeline/timeGrid";

describe("timeGrid", () => {
  it("beatToX and xToBeat are inverses for a given zoom", () => {
    expect(beatToX(4, 64)).toBe(256);
    expect(xToBeat(256, 64)).toBe(4);
    expect(xToBeat(beatToX(3.5, 48), 48)).toBeCloseTo(3.5);
  });

  it("snapBeat snaps to the nearest division; floorBeat snaps down", () => {
    expect(snapBeat(0.6, 0.25)).toBe(0.5);
    expect(snapBeat(0.62, 0.25)).toBe(0.5);
    expect(snapBeat(0.63, 0.25)).toBe(0.75);
    expect(snapBeat(1.4, 1)).toBe(1);
    expect(floorBeat(0.9, 0.25)).toBe(0.75);
    expect(floorBeat(1.9, 1)).toBe(1);
  });

  describe("snapDelta (DAW-8.8: a drag snaps where it lands, not how far it moved)", () => {
    const toGrid = (division: number) => (beat: number) => snapBeat(beat, division);

    it("puts an off-grid note ONTO the grid, which snapping the movement never did", () => {
      // The bug: snapBeat(1) added to 0.37 is 1.37, and every further drag keeps the .37.
      expect(0.37 + snapBeat(1, 0.25)).toBe(1.37);
      expect(0.37 + snapDelta(0.37, 1, toGrid(0.25))).toBe(1.25);
    });

    it("holds a note that is already on the grid exactly on it", () => {
      expect(0.5 + snapDelta(0.5, 1, toGrid(0.25))).toBe(1.5);
      expect(0.5 + snapDelta(0.5, 0.1, toGrid(0.25))).toBe(0.5);
    });

    it("keeps a chord's internal spacing, because the delta is shared", () => {
      // An anchor at 0.37 with a second note 0.3 later: the anchor lands on a line and the
      // other note keeps its distance, rather than both collapsing onto the same one.
      const delta = snapDelta(0.37, 1, toGrid(0.25));
      expect(0.37 + delta).toBe(1.25);
      expect(0.67 + delta).toBeCloseTo(1.55);
    });

    it("passes the movement straight through when the caller does not snap", () => {
      expect(snapDelta(0.37, 0.13, (beat) => beat)).toBeCloseTo(0.13);
    });

    it("reports the delta the clamp allowed, not the one asked for", () => {
      // `place` carries the clamp, so a drag past a bound moves everything by what the anchor
      // could actually travel - the selection cannot be pushed through the edge one note at a time.
      const clampedToFour = (beat: number) => Math.min(snapBeat(beat, 0.25), 4);
      expect(snapDelta(3.5, 2, clampedToFour)).toBe(0.5);
    });
  });

  it("beatTicks flags bar starts and numbers bars (4/4)", () => {
    const ticks = beatTicks(8, { numerator: 4, denominator: 4 });
    // 0..8 inclusive
    expect(ticks).toHaveLength(9);
    expect(ticks.filter((t) => t.isBar).map((t) => t.beat)).toEqual([0, 4, 8]);
    expect(ticks.find((t) => t.beat === 0)?.bar).toBe(1);
    expect(ticks.find((t) => t.beat === 4)?.bar).toBe(2);
    expect(ticks.find((t) => t.beat === 2)?.isBar).toBe(false);
  });

  it("beatTicks defaults to 4/4 when no signature is given", () => {
    expect(
      beatTicks(4)
        .filter((t) => t.isBar)
        .map((t) => t.beat),
    ).toEqual([0, 4]);
  });

  it("beatTicks subdivides by the denominator and lands bar lines on fractional beats (7/8)", () => {
    const ticks = beatTicks(7, { numerator: 7, denominator: 8 });
    // eighth-note grid: a tick every 0.5 beats, 0..7 inclusive
    expect(ticks).toHaveLength(15);
    // bars every 7 eighths = every 3.5 beats, each landing exactly on a tick
    expect(ticks.filter((t) => t.isBar).map((t) => t.beat)).toEqual([0, 3.5, 7]);
    expect(ticks.find((t) => t.beat === 3.5)?.bar).toBe(2);
    expect(ticks.find((t) => t.beat === 0.5)?.isBar).toBe(false);
  });
});
