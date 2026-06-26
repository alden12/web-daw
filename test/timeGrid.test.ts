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
    const ticks = beatTicks(8, 4);
    // 0..8 inclusive
    expect(ticks).toHaveLength(9);
    expect(ticks.filter((t) => t.isBar).map((t) => t.beat)).toEqual([0, 4, 8]);
    expect(ticks.find((t) => t.beat === 0)?.bar).toBe(1);
    expect(ticks.find((t) => t.beat === 4)?.bar).toBe(2);
    expect(ticks.find((t) => t.beat === 2)?.isBar).toBe(false);
  });
});
