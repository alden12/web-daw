import { describe, expect, it } from "vitest";
import { analyzeMix, summarizeMix, type AudioBufferLike } from "../src/audio/analysis/analyze";

/** A minimal AudioBuffer stub from raw channel data (jsdom has no real AudioBuffer). */
function buffer(channels: Float32Array[], sampleRate = 48000): AudioBufferLike {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel) => channels[channel],
  };
}

const filled = (length: number, value: number) => new Float32Array(length).fill(value);

describe("analyzeMix", () => {
  it("reports silence as peak 0, floored dBFS, and no clipping", () => {
    const analysis = analyzeMix(buffer([filled(1000, 0), filled(1000, 0)]));
    expect(analysis.peak).toBe(0);
    expect(analysis.peakDbfs).toBe(-120);
    expect(analysis.clipping).toEqual({ clipped: false, sampleCount: 0, fraction: 0 });
  });

  it("measures peak and RMS of a constant signal (0.5 => ~-6 dBFS)", () => {
    const analysis = analyzeMix(buffer([filled(1000, 0.5), filled(1000, -0.5)]));
    expect(analysis.peak).toBeCloseTo(0.5, 6);
    expect(analysis.rms).toBeCloseTo(0.5, 6);
    expect(analysis.peakDbfs).toBeCloseTo(-6.02, 1);
    expect(analysis.headroomDb).toBeCloseTo(6.02, 1);
    expect(analysis.clipping.clipped).toBe(false);
  });

  it("detects clipping when samples reach full scale", () => {
    const data = filled(100, 0.2);
    data[10] = 1.0;
    data[20] = -1.0;
    const analysis = analyzeMix(buffer([data]));
    expect(analysis.clipping.clipped).toBe(true);
    expect(analysis.clipping.sampleCount).toBe(2);
    expect(analysis.peak).toBeCloseTo(1.0, 6);
  });
});

describe("summarizeMix", () => {
  it("flags a silent render", () => {
    const summary = summarizeMix(analyzeMix(buffer([filled(100, 0)])));
    expect(summary.note).toMatch(/silent/i);
    expect(summary.clipping).toBe(false);
  });

  it("flags clipping with a corrective note", () => {
    const data = filled(100, 0.3);
    data[5] = 1.0;
    const summary = summarizeMix(analyzeMix(buffer([data])));
    expect(summary.clipping).toBe(true);
    expect(summary.clippedSamples).toBe(1);
    expect(summary.note).toMatch(/clipping/i);
  });

  it("calls a healthy level healthy", () => {
    const summary = summarizeMix(analyzeMix(buffer([filled(1000, 0.25)])));
    expect(summary.clipping).toBe(false);
    expect(summary.note).toMatch(/healthy/i);
  });
});
