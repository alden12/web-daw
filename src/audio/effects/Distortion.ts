/**
 * Waveshaper distortion: input -> shaper -> tone (lowpass) -> wet. `dist.drive`
 * sets the curve amount, `dist.tone` tames the high end, `mix` blends.
 */
import type { ParamStore } from '../params/store';
import { rampParam, type ParamBinding } from '../params/binding';
import { BaseEffect } from './BaseEffect';

/** Classic tanh-ish waveshaper curve; higher `amount` = more drive. */
function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  // Allocate from an explicit ArrayBuffer so the type matches WaveShaperNode.curve.
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export class DistortionEffect extends BaseEffect {
  private shaper!: WaveShaperNode;
  private tone!: BiquadFilterNode;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.shaper = this.ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.tone = this.ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.input.connect(this.shaper).connect(this.tone).connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      'dist.drive': { apply: (v) => void (this.shaper.curve = distortionCurve(v as number)) },
      'dist.tone': { apply: (v, ms) => rampParam(this.ctx, this.tone.frequency, v as number, ms) },
    };
  }

  protected teardown(): void {
    this.shaper.disconnect();
    this.tone.disconnect();
  }
}
