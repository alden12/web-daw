import { describe, it, expect } from "vitest";
import { euclideanPattern } from "../src/audio/midi/device/devices/euclid/pattern";

/** Render a pattern the way the literature writes it, so expectations read as rhythms. */
const show = (pattern: boolean[]) => pattern.map((onset) => (onset ? "x" : ".")).join("");

describe("euclideanPattern", () => {
  it("produces the canonical necklaces from Toussaint's paper", () => {
    expect(show(euclideanPattern(8, 3))).toBe("x..x..x."); // tresillo
    expect(show(euclideanPattern(8, 5))).toBe("x.xx.xx."); // cinquillo
    expect(show(euclideanPattern(4, 2))).toBe("x.x.");
    expect(show(euclideanPattern(16, 4))).toBe("x...x...x...x...");
    expect(show(euclideanPattern(16, 5))).toBe("x..x..x..x..x...");
    expect(show(euclideanPattern(12, 5))).toBe("x..x.x..x.x.");
  });

  it("always places exactly `pulses` onsets across `steps`", () => {
    for (let steps = 1; steps <= 32; steps++) {
      for (let pulses = 0; pulses <= steps; pulses++) {
        const pattern = euclideanPattern(steps, pulses);
        expect(pattern).toHaveLength(steps);
        expect(pattern.filter(Boolean)).toHaveLength(pulses);
      }
    }
  });

  it("rotates the necklace without changing the rhythm's shape", () => {
    const base = euclideanPattern(8, 3);
    expect(show(euclideanPattern(8, 3, 1))).toBe("..x..x.x");
    // A full turn is the identity, and every turn keeps the pulse count.
    expect(show(euclideanPattern(8, 3, 8))).toBe(show(base));
    for (let rotate = 0; rotate < 8; rotate++) {
      expect(euclideanPattern(8, 3, rotate).filter(Boolean)).toHaveLength(3);
    }
  });

  it("handles negative and oversized rotations by wrapping", () => {
    expect(show(euclideanPattern(8, 3, -1))).toBe(show(euclideanPattern(8, 3, 7)));
    expect(show(euclideanPattern(8, 3, 17))).toBe(show(euclideanPattern(8, 3, 1)));
  });

  it("clamps degenerate pulse counts instead of throwing", () => {
    expect(show(euclideanPattern(8, 0))).toBe("........");
    expect(show(euclideanPattern(8, 8))).toBe("xxxxxxxx");
    expect(show(euclideanPattern(8, 99))).toBe("xxxxxxxx");
    expect(show(euclideanPattern(8, -3))).toBe("........");
    expect(euclideanPattern(0, 3)).toHaveLength(1); // steps floors at 1
  });
});
