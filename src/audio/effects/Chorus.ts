/**
 * Chorus: a short, LFO-modulated delay blended with the dry signal, giving the
 * shimmer of several detuned voices. input -> delay -> wet, with
 * lfo -> lfoGain -> delay.delayTime sweeping the delay around a ~25 ms base.
 * `chorus.rate` is the LFO speed, `chorus.depth` the sweep amount, `mix` blends.
 *
 * Added entirely through the registration API (schema in catalog.ts, factory in
 * registry.ts) without touching any central catalog object - the worked example
 * of the extension point.
 */
import type { ParamStore } from '../params/store';
import { rampParam, type ParamBinding } from '../params/binding';
import { BaseEffect } from './BaseEffect';

/** Centre delay time, and the max +/- swing the LFO adds at depth = 1. */
const BASE_DELAY = 0.025;
const MAX_SWING = 0.01;

export class ChorusEffect extends BaseEffect {
  private delay!: DelayNode;
  private lfo!: OscillatorNode;
  private lfoGain!: GainNode;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.delay = this.ctx.createDelay(BASE_DELAY + MAX_SWING + 0.05);
    this.delay.delayTime.value = BASE_DELAY;
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoGain = this.ctx.createGain();
    this.lfo.connect(this.lfoGain).connect(this.delay.delayTime);
    this.lfo.start();
    this.input.connect(this.delay).connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      'chorus.rate': { apply: (v, ms) => rampParam(this.ctx, this.lfo.frequency, v as number, ms) },
      'chorus.depth': { apply: (v, ms) => rampParam(this.ctx, this.lfoGain.gain, (v as number) * MAX_SWING, ms) },
    };
  }

  protected teardown(): void {
    try {
      this.lfo.stop();
    } catch {
      // already stopped
    }
    this.lfo.disconnect();
    this.lfoGain.disconnect();
    this.delay.disconnect();
  }
}
