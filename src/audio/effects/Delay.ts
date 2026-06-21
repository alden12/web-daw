/**
 * Feedback delay: input -> delay -> wet, with delay -> feedback -> delay for the
 * repeats. `delay.time` (s), `delay.feedback` (0..0.95), `mix`.
 */
import type { ParamStore } from '../params/store';
import { rampParam, type ParamBinding } from '../params/binding';
import { BaseEffect } from './BaseEffect';

export class DelayEffect extends BaseEffect {
  private delay!: DelayNode;
  private feedback!: GainNode;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.delay = this.ctx.createDelay(2);
    this.feedback = this.ctx.createGain();
    this.input.connect(this.delay);
    this.delay.connect(this.feedback).connect(this.delay);
    this.delay.connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      'delay.time': { apply: (v, ms) => rampParam(this.ctx, this.delay.delayTime, v as number, ms) },
      'delay.feedback': { apply: (v, ms) => rampParam(this.ctx, this.feedback.gain, v as number, ms) },
    };
  }

  protected teardown(): void {
    this.delay.disconnect();
    this.feedback.disconnect();
  }
}
