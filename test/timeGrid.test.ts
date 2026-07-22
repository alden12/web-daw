import { describe, expect, it } from "vitest";
import { beatToX, xToBeat, snapBeat, floorBeat, beatTicks } from "../src/ui/timeline/timeGrid";

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
