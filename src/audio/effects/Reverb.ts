/**
 * Convolution reverb with a synthesized impulse: input -> convolver -> wet. The
 * impulse is exponentially-decaying noise regenerated when `reverb.decay` (s)
 * changes; `mix` blends the wet tail with the dry signal.
 */
import type { ParamStore } from "../params/store";
import { type ParamBinding } from "../params/binding";
import { BaseEffect } from "./BaseEffect";

export class ReverbEffect extends BaseEffect {
  private convolver!: ConvolverNode;

  constructor(ctx: AudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.convolver = this.ctx.createConvolver();
    this.input.connect(this.convolver).connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      "reverb.decay": { apply: (v) => void (this.convolver.buffer = this.makeImpulse(v as number)) },
    };
  }

  private makeImpulse(decaySec: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * decaySec));
    const buffer = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.5;
      }
    }
    return buffer;
  }

  protected teardown(): void {
    this.convolver.disconnect();
  }
}
