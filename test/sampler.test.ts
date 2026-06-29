import { describe, expect, it } from "vitest";
import { playbackRateFor } from "../src/audio/instruments/Sampler";
import { samplerSchema } from "../src/audio/instruments/catalog";

describe("sampler playback rate (keytracking)", () => {
  it("is unity at the root note when keytracking", () => {
    expect(playbackRateFor(60, 60, true)).toBeCloseTo(1);
  });

  it("doubles an octave up and halves an octave down", () => {
    expect(playbackRateFor(72, 60, true)).toBeCloseTo(2);
    expect(playbackRateFor(48, 60, true)).toBeCloseTo(0.5);
  });

  it("is always unity when keytracking is off", () => {
    expect(playbackRateFor(72, 60, false)).toBe(1);
    expect(playbackRateFor(36, 60, false)).toBe(1);
  });
});

describe("sampler schema", () => {
  it("exposes a sample param defaulting to a built-in, plus root + keytrack", () => {
    const byId = Object.fromEntries(samplerSchema.map((spec) => [spec.id, spec]));
    expect(byId["sampler.sample"].kind).toBe("sample");
    expect(byId["sampler.sample"].default).toBe("builtin:kick");
    expect(byId["sampler.root"].kind).toBe("number");
    expect(byId["sampler.keytrack"].kind).toBe("boolean");
  });
});
