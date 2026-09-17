import { describe, expect, it } from "vitest";
import { grooveAt } from "../src/audio/sequencer/groove";
import { GROOVES, grooveById } from "../src/audio/grooves/catalog";

const straight = grooveById("straight");
const swing58 = grooveById("8th-58"); // grid 0.5, off-beat offset 0.08
const accent = grooveById("8th-accent");

describe("grooveAt", () => {
  it("straight is a no-op everywhere", () => {
    for (const at of [0, 0.5, 1, 1.5, 2.25]) {
      expect(grooveAt(straight, at, 1)).toEqual({ offsetBeats: 0, velocityScale: 1 });
    }
  });

  it("8th swing leaves the on-beat and delays the off-beat", () => {
    expect(grooveAt(swing58, 0, 1).offsetBeats).toBeCloseTo(0); // on-beat
    expect(grooveAt(swing58, 1, 1).offsetBeats).toBeCloseTo(0); // next on-beat
    expect(grooveAt(swing58, 0.5, 1).offsetBeats).toBeCloseTo(0.08); // off-beat delayed
    expect(grooveAt(swing58, 1.5, 1).offsetBeats).toBeCloseTo(0.08); // tiles across bars
  });

  it("amount scales the offset and is a no-op at 0", () => {
    expect(grooveAt(swing58, 0.5, 0).offsetBeats).toBe(0);
    expect(grooveAt(swing58, 0.5, 0.5).offsetBeats).toBeCloseTo(0.04);
    expect(grooveAt(swing58, 0.5, 1).offsetBeats).toBeCloseTo(0.08);
  });

  it("interpolates velocityScale by amount", () => {
    // accent off-beat scales velocity to 0.82 at full amount
    expect(grooveAt(accent, 0.5, 1).velocityScale).toBeCloseTo(0.82);
    expect(grooveAt(accent, 0.5, 0.5).velocityScale).toBeCloseTo(0.91); // halfway to 1
    expect(grooveAt(accent, 0, 1).velocityScale).toBeCloseTo(1); // on-beat unchanged
  });

  it("snaps off-grid notes to the nearest slot", () => {
    // 0.46 is nearest the off-beat slot (0.5) on a 0.5 grid
    expect(grooveAt(swing58, 0.46, 1).offsetBeats).toBeCloseTo(0.08);
    // 0.1 is nearest the on-beat slot (0)
    expect(grooveAt(swing58, 0.1, 1).offsetBeats).toBeCloseTo(0);
  });
});

describe("groove catalog", () => {
  it("has a straight default and swing presets", () => {
    expect(GROOVES[0].id).toBe("straight");
    expect(GROOVES.map((g) => g.id)).toContain("8th-58");
  });

  it("grooveById falls back to straight for unknown ids", () => {
    expect(grooveById("nope").id).toBe("straight");
  });
});
