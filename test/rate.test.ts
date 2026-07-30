import { describe, it, expect } from "vitest";
import { rateToBeats, RATE_OPTIONS } from "../src/audio/midi/device/devices/rate";

describe("rateToBeats", () => {
  it("maps divisions to beats (quarter = 1 beat; T = triplet)", () => {
    expect(rateToBeats("1/4")).toBe(1);
    expect(rateToBeats("1/8")).toBe(0.5);
    expect(rateToBeats("1/16")).toBe(0.25);
    expect(rateToBeats("1/8T")).toBeCloseTo(1 / 3);
    expect(rateToBeats("bogus")).toBe(0.5); // default
  });

  it("resolves every option the rate params offer", () => {
    for (const rate of RATE_OPTIONS) expect(rateToBeats(rate)).toBeGreaterThan(0);
  });
});
