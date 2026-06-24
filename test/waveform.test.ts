import { describe, expect, it } from 'vitest';
import { computePeaks } from '../src/audio/waveform';

describe('computePeaks', () => {
  it('reduces samples to per-bucket min/max', () => {
    // 8 samples, 2 buckets: [0,1,-1,0.5] and [-0.5,0.25,-0.25,1]
    const samples = new Float32Array([0, 1, -1, 0.5, -0.5, 0.25, -0.25, 1]);
    const { min, max } = computePeaks(samples, 2);
    expect(min.length).toBe(2);
    expect(max.length).toBe(2);
    expect(max[0]).toBeCloseTo(1);
    expect(min[0]).toBeCloseTo(-1);
    expect(max[1]).toBeCloseTo(1);
    expect(min[1]).toBeCloseTo(-0.5);
  });

  it('captures the extremes of a full-scale ramp in one bucket', () => {
    const { min, max } = computePeaks(new Float32Array([-1, -0.4, 0.4, 1]), 1);
    expect(min[0]).toBeCloseTo(-1);
    expect(max[0]).toBeCloseTo(1);
  });

  it('clamps buckets to the sample count (no empty buckets)', () => {
    const { min, max } = computePeaks(new Float32Array([0.5, -0.5]), 10);
    expect(min.length).toBe(2);
    expect(max.length).toBe(2);
  });

  it('returns a single flat bucket for empty input', () => {
    const { min, max } = computePeaks(new Float32Array(0), 2048);
    expect(min.length).toBe(1);
    expect(max.length).toBe(1);
    expect(min[0]).toBe(0);
    expect(max[0]).toBe(0);
  });
});
