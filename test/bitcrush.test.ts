import { describe, it, expect } from 'vitest';
import { quantizeSample, holdStep, crushSample, makeHoldState } from '../src/audio/dsp/bitcrush';

describe('quantizeSample (bit-depth reduction)', () => {
  it('bits <= 0 is a passthrough', () => {
    expect(quantizeSample(0.42, 0)).toBe(0.42);
    expect(quantizeSample(-0.137, -3)).toBe(-0.137);
  });

  it('1 bit snaps to the two rails', () => {
    expect(quantizeSample(-1, 1)).toBe(-1);
    expect(quantizeSample(1, 1)).toBe(1);
    expect(quantizeSample(0.6, 1)).toBe(1);
    expect(quantizeSample(-0.6, 1)).toBe(-1);
  });

  it('2 bits gives 4 levels (-1, -1/3, 1/3, 1)', () => {
    expect(quantizeSample(-1, 2)).toBeCloseTo(-1);
    expect(quantizeSample(1, 2)).toBeCloseTo(1);
    expect(quantizeSample(0, 2)).toBeCloseTo(1 / 3);
    expect(quantizeSample(0.5, 2)).toBeCloseTo(1 / 3);
    expect(quantizeSample(-0.5, 2)).toBeCloseTo(-1 / 3);
  });

  it('preserves the rails at any bit depth and is idempotent', () => {
    for (const bits of [1, 4, 8, 16]) {
      expect(quantizeSample(-1, bits)).toBeCloseTo(-1);
      expect(quantizeSample(1, bits)).toBeCloseTo(1);
      const q = quantizeSample(0.371, bits);
      expect(quantizeSample(q, bits)).toBeCloseTo(q); // re-quantizing a level is a no-op
    }
  });
});

describe('holdStep (sample-rate reduction)', () => {
  it('downsample 1 takes a fresh sample every frame', () => {
    const s = makeHoldState();
    expect(holdStep(0.1, 1, s)).toBe(0.1);
    expect(holdStep(0.2, 1, s)).toBe(0.2);
    expect(holdStep(0.3, 1, s)).toBe(0.3);
  });

  it('downsample 2 holds each sample for two frames', () => {
    const s = makeHoldState();
    expect(holdStep(0.1, 2, s)).toBe(0.1); // fresh
    expect(holdStep(0.9, 2, s)).toBe(0.1); // held (input ignored)
    expect(holdStep(0.3, 2, s)).toBe(0.3); // fresh again
    expect(holdStep(0.9, 2, s)).toBe(0.3); // held
  });

  it('values below 1 act as every-frame (period clamps to 1)', () => {
    const s = makeHoldState();
    expect(holdStep(0.1, 0.4, s)).toBe(0.1);
    expect(holdStep(0.2, 0.4, s)).toBe(0.2);
  });
});

describe('crushSample (downsample then quantize)', () => {
  it('holds and quantizes together', () => {
    const s = makeHoldState();
    // 1-bit + hold-2: first frame quantizes its fresh sample to a rail and holds it.
    const a = crushSample(0.7, 1, 2, s);
    expect(a).toBe(1);
    expect(crushSample(-0.9, 1, 2, s)).toBe(1); // held value re-quantized, input ignored
  });
});
