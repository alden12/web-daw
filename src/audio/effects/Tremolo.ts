/**
 * Tremolo: an LFO modulating amplitude. input -> tremGain -> wet, with
 * lfo -> lfoGain -> tremGain.gain. `tremolo.rate` is the LFO speed and
 * `tremolo.depth` how deep the level dips (depth=1 swings down to silence); the
 * gain rides between 1-depth and 1. `mix` blends, though tremolo is usually full.
 */
import type { ParamStore } from '../params/store';
import { rampParam, type ParamBinding } from '../params/binding';
import { BaseEffect } from './BaseEffect';

export class TremoloEffect extends BaseEffect {
  private tremGain!: GainNode;
  private lfo!: OscillatorNode;
  private lfoGain!: GainNode;
  private depth = 0.6;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.tremGain = this.ctx.createGain();
    this.tremGain.gain.value = 1 - this.depth / 2;
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoGain = this.ctx.createGain();
    this.lfo.connect(this.lfoGain).connect(this.tremGain.gain);
    this.lfo.start();
    this.input.connect(this.tremGain).connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      'tremolo.rate': { apply: (v, ms) => rampParam(this.ctx, this.lfo.frequency, v as number, ms) },
      'tremolo.depth': {
        apply: (v, ms) => {
          this.depth = v as number;
          rampParam(this.ctx, this.tremGain.gain, 1 - this.depth / 2, ms); // centre the swing
          rampParam(this.ctx, this.lfoGain.gain, this.depth / 2, ms);
        },
      },
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
    this.tremGain.disconnect();
  }
}
