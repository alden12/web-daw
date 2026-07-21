/**
 * Resonant lowpass filter with an LFO sweep: input -> filter -> wet, and
 * lfo -> lfoGain -> filter.frequency for movement. `filter.cutoff`/`resonance`
 * set the base; `lfo.rate`/`lfo.depth` set the sweep (depth scales the cutoff so
 * depth=1 sweeps roughly +/- the cutoff). `mix` blends.
 */
import type { ParamStore } from "../params/store";
import { rampParam, type ParamBinding } from "../params/binding";
import { BaseEffect } from "./BaseEffect";

export class FilterEffect extends BaseEffect {
  private filter!: BiquadFilterNode;
  private lfo!: OscillatorNode;
  private lfoGain!: GainNode;
  private baseCutoff = 2000;
  private depth = 0.5;

  constructor(ctx: BaseAudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.lfo = this.ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfoGain = this.ctx.createGain();
    this.lfo.connect(this.lfoGain).connect(this.filter.frequency);
    this.lfo.start();
    this.input.connect(this.filter).connect(this.wet);
  }

  private applyDepth(ms?: number): void {
    rampParam(this.ctx, this.lfoGain.gain, this.depth * this.baseCutoff, ms);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      "filter.cutoff": {
        apply: (v, ms) => {
          this.baseCutoff = v as number;
          rampParam(this.ctx, this.filter.frequency, this.baseCutoff, ms);
          this.applyDepth(ms);
        },
      },
      "filter.resonance": { apply: (v, ms) => rampParam(this.ctx, this.filter.Q, v as number, ms) },
      "lfo.rate": { apply: (v, ms) => rampParam(this.ctx, this.lfo.frequency, v as number, ms) },
      "lfo.depth": {
        apply: (v, ms) => {
          this.depth = v as number;
          this.applyDepth(ms);
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
    this.filter.disconnect();
  }
}
