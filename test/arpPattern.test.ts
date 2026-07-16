import { describe, it, expect } from "vitest";
import { arpPitch, rateToBeats } from "../src/audio/midi/device/devices/arp/pattern";

describe("arpPitch", () => {
  const chord = [60, 64, 67];

  it("up walks the chord ascending and wraps", () => {
    expect([0, 1, 2, 3, 4].map((step) => arpPitch(chord, "up", 1, step))).toEqual([60, 64, 67, 60, 64]);
  });

  it("down walks the chord descending", () => {
    expect([0, 1, 2, 3].map((step) => arpPitch(chord, "down", 1, step))).toEqual([67, 64, 60, 67]);
  });

  it("updown ascends then descends without repeating the peak/trough", () => {
    // sequence [60,64,67,64], period 4
    expect([0, 1, 2, 3, 4, 5].map((step) => arpPitch(chord, "updown", 1, step))).toEqual([60, 64, 67, 64, 60, 64]);
  });

  it("octaves stack the chord upward", () => {
    expect([0, 1, 2, 3, 4, 5].map((step) => arpPitch(chord, "up", 2, step))).toEqual([60, 64, 67, 72, 76, 79]);
  });

  it("random stays within the stacked chord and is deterministic per step", () => {
    const pool = new Set([60, 64, 67, 72, 76, 79]);
    for (let step = 0; step < 20; step++) {
      const pitch = arpPitch(chord, "random", 2, step)!;
      expect(pool.has(pitch)).toBe(true);
      expect(arpPitch(chord, "random", 2, step)).toBe(pitch); // stable
    }
  });

  it("returns null for an empty chord", () => {
    expect(arpPitch([], "up", 1, 0)).toBeNull();
  });
});

describe("rateToBeats", () => {
  it("maps divisions to beats (quarter = 1 beat; T = triplet)", () => {
    expect(rateToBeats("1/4")).toBe(1);
    expect(rateToBeats("1/8")).toBe(0.5);
    expect(rateToBeats("1/16")).toBe(0.25);
    expect(rateToBeats("1/8T")).toBeCloseTo(1 / 3);
    expect(rateToBeats("bogus")).toBe(0.5); // default
  });
});
