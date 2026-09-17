import { describe, it, expect } from "vitest";
import { detectOnsets, estimateOffsetMs } from "../src/audio/recording/calibration";

/** Build a mono buffer with short decaying "tap" transients at the given times (sec). */
function bufferWithTaps(times: number[], sampleRate: number, lengthSec: number): Float32Array {
  const samples = new Float32Array(Math.round(lengthSec * sampleRate));
  for (const time of times) {
    const start = Math.round(time * sampleRate);
    const decay = Math.round(0.02 * sampleRate); // 20ms burst
    for (let i = 0; i < decay && start + i < samples.length; i++) {
      samples[start + i] = (1 - i / decay) * (i % 2 === 0 ? 1 : -1); // decaying alternating spike
    }
  }
  return samples;
}

describe("detectOnsets", () => {
  it("finds one onset per transient, near the true time", () => {
    const sampleRate = 48000;
    const taps = [0.5, 1.25, 2.0];
    const onsets = detectOnsets(bufferWithTaps(taps, sampleRate, 2.5), sampleRate);
    expect(onsets.length).toBe(3);
    onsets.forEach((onset, index) => expect(Math.abs(onset - taps[index])).toBeLessThan(0.01));
  });

  it("returns nothing for silence", () => {
    expect(detectOnsets(new Float32Array(48000), 48000)).toEqual([]);
  });

  it("debounces a single ringing tap into one onset (refractory gap)", () => {
    const sampleRate = 48000;
    // Two spikes 10ms apart are one tap's ring; the 80ms refractory folds them into one.
    const onsets = detectOnsets(bufferWithTaps([0.5, 0.51], sampleRate, 1.0), sampleRate);
    expect(onsets.length).toBe(1);
  });
});

describe("estimateOffsetMs", () => {
  it("returns the median latency between clicks and their taps", () => {
    const clicks = [0.6, 1.35, 2.1, 2.85];
    const latency = 0.05; // 50ms late
    const onsets = clicks.map((click) => click + latency);
    const result = estimateOffsetMs(onsets, clicks, 0.375);
    expect(result).not.toBeNull();
    expect(result!.offsetMs).toBe(50);
    expect(result!.matched).toBe(4);
  });

  it("rejects outliers via the median (a missed/extra tap doesn't skew it)", () => {
    const clicks = [0.6, 1.35, 2.1, 2.85];
    const onsets = [0.66, 1.41, 2.16, 2.91, 5.0]; // 60ms late + one spurious far tap
    const result = estimateOffsetMs(onsets, clicks, 0.375);
    expect(result!.offsetMs).toBe(60);
    expect(result!.matched).toBe(4); // the spurious 5.0 is out of tolerance
  });

  it("returns null when no tap lands within tolerance", () => {
    expect(estimateOffsetMs([9, 10], [0.6, 1.35], 0.375)).toBeNull();
  });

  it("reports the tap spread (0 when perfectly consistent, larger when jittery)", () => {
    const clicks = [0.6, 1.35, 2.1, 2.85];
    const tight = estimateOffsetMs(
      clicks.map((click) => click + 0.05),
      clicks,
      0.375,
    );
    expect(tight!.spreadMs).toBe(0);
    // Gaps 40/50/60/70ms -> median 55ms, MAD 10ms.
    const jittery = estimateOffsetMs([0.64, 1.4, 2.16, 2.92], clicks, 0.375);
    expect(jittery!.spreadMs).toBe(10);
  });
});
