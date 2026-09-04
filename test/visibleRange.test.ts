import { describe, expect, it } from "vitest";
import { clampIntoView } from "../src/ui/roll/visibleRange";

/** A phone-ish roll: 300px of scroller with a 38px sticky label column, holding a 32px kebab. */
const ROLL = { width: 32, clientWidth: 300, leadPx: 38 };

describe("clampIntoView", () => {
  it("leaves something already on screen where it was asked to go", () => {
    expect(clampIntoView({ ...ROLL, wanted: 120, scrollLeft: 0 })).toBe(120);
    expect(clampIntoView({ ...ROLL, wanted: 500, scrollLeft: 400 })).toBe(500);
  });

  it("pins to the right edge rather than following a note off it", () => {
    // The case this exists for: a note wider than the viewport, whose right edge - and so its
    // actions - is somewhere off to the right.
    const placed = clampIntoView({ ...ROLL, wanted: 9000, scrollLeft: 0 });
    expect(placed).toBe(300 - 38 - 32);
    // The far edge lands exactly on the boundary, not the near one: clamping the left edge to
    // the viewport would leave the button itself hanging over it.
    expect(placed + ROLL.width).toBe(ROLL.clientWidth - ROLL.leadPx);
  });

  it("allows for the sticky label column, which covers the near edge at every offset", () => {
    // The column does not scroll away, so the room on the right is that much shorter than the
    // scroller is wide. Forgetting it puts the kebab half under the labels' opposite number.
    const withColumn = clampIntoView({ ...ROLL, wanted: 9000, scrollLeft: 0 });
    const without = clampIntoView({ ...ROLL, leadPx: 0, wanted: 9000, scrollLeft: 0 });
    expect(without - withColumn).toBe(ROLL.leadPx);
  });

  it("pins to the near edge when the note has been scrolled off to the left", () => {
    expect(clampIntoView({ ...ROLL, wanted: 40, scrollLeft: 600 })).toBe(600);
  });

  it("stays reachable in a viewport too narrow to hold it", () => {
    // The near edge wins the tie, so a cramped landscape shows a button pressed against the
    // labels rather than one pushed off the other side.
    expect(clampIntoView({ wanted: 500, width: 32, clientWidth: 50, leadPx: 38, scrollLeft: 100 })).toBe(100);
  });
});
