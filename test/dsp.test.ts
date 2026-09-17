import { describe, expect, it } from "vitest";
import { polyBlep, polyBlepSaw, polyBlepPulse } from "../src/audio/dsp/oscillators";
import { makeLadderState, ladderCoeffs, ladderStep } from "../src/audio/dsp/ladder";

const SR = 44100;

/** RMS of a filtered sine sweep at `freq` Hz, over `n` samples, for a given cutoff. */
function filteredRms(freq: number, cutoffHz: number, resonance: number, n = 4000): number {
  const state = makeLadderState();
  const coeffs = ladderCoeffs(cutoffHz, resonance, SR);
  const inc = (2 * Math.PI * freq) / SR;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const out = ladderStep(Math.sin(i * inc), coeffs, state);
    // Ignore the initial transient; measure the settled second half.
    if (i >= n / 2) sumSq += out * out;
  }
  return Math.sqrt(sumSq / (n / 2));
}

describe("polyBlep oscillators", () => {
  it("returns no correction away from a discontinuity", () => {
    expect(polyBlep(0.5, 0.01)).toBe(0);
  });

  it("corrects within one sample either side of the edge", () => {
    expect(polyBlep(0.001, 0.01)).not.toBe(0); // just after the rising edge
    expect(polyBlep(0.999, 0.01)).not.toBe(0); // just before wrap
  });

  it("a saw ramps across its cycle and stays roughly in range", () => {
    const dt = 0.001;
    expect(polyBlepSaw(0.25, dt)).toBeLessThan(polyBlepSaw(0.75, dt));
    for (let phase = 0; phase < 1; phase += 0.01) {
      expect(Math.abs(polyBlepSaw(phase, dt))).toBeLessThan(1.6);
    }
  });

  it("a 50% pulse is high in the first half and low in the second", () => {
    const dt = 0.001;
    expect(polyBlepPulse(0.25, dt, 0.5)).toBeGreaterThan(0);
    expect(polyBlepPulse(0.75, dt, 0.5)).toBeLessThan(0);
  });

  it("pulse width shifts where the pulse falls", () => {
    const dt = 0.001;
    // At pw = 0.8 the point 0.7 is still in the 'high' region (unlike pw = 0.5).
    expect(polyBlepPulse(0.7, dt, 0.8)).toBeGreaterThan(0);
    expect(polyBlepPulse(0.7, dt, 0.5)).toBeLessThan(0);
  });
});

describe("ladder filter", () => {
  it("stays finite and bounded for a hot input", () => {
    const state = makeLadderState();
    const coeffs = ladderCoeffs(2000, 0.9, SR);
    for (let i = 0; i < 10000; i++) {
      const out = ladderStep(Math.sin(i * 0.3) * 2, coeffs, state);
      expect(Number.isFinite(out)).toBe(true);
      expect(Math.abs(out)).toBeLessThan(10);
    }
  });

  it("attenuates content above the cutoff more than below it (low-pass)", () => {
    const cutoff = 800;
    const below = filteredRms(200, cutoff, 0.1);
    const above = filteredRms(6000, cutoff, 0.1);
    expect(above).toBeLessThan(below * 0.5);
  });

  it("passes a low tone with little loss", () => {
    // A tone well below cutoff keeps most of its ~0.707 RMS.
    expect(filteredRms(150, 4000, 0.1)).toBeGreaterThan(0.4);
  });

  it("resonance boosts energy near the cutoff", () => {
    const lowQ = filteredRms(800, 800, 0.05);
    const highQ = filteredRms(800, 800, 0.9);
    expect(highQ).toBeGreaterThan(lowQ);
  });
});
