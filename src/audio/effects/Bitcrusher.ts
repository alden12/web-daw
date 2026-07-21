/**
 * Bitcrusher: input -> bitcrusher-processor (AudioWorklet) -> wet. The DSP lives in
 * the worklet (src/audio/worklets/bitcrusher.worklet.ts, sharing src/audio/dsp/
 * bitcrush.ts); this is just the node wrapper. `bits` and `downsample` are the
 * processor's AudioParams, so they bind and smooth through the same `rampParam` path
 * as every native-node effect. The worklet module must already be registered on the
 * context (the engine awaits `loadWorklets` before constructing effects).
 */
import type { ParamStore } from "../params/store";
import { rampParam, type ParamBinding } from "../params/binding";
import { BaseEffect } from "./BaseEffect";

export class BitcrusherEffect extends BaseEffect {
  private node!: AudioWorkletNode;

  constructor(ctx: BaseAudioContext, store: ParamStore) {
    super(ctx, store);
    this.init();
  }

  protected buildGraph(): void {
    this.node = new AudioWorkletNode(this.ctx, "bitcrusher-processor");
    this.input.connect(this.node);
    this.node.connect(this.wet);
  }

  protected buildBindings(): Record<string, ParamBinding> {
    return {
      ...this.commonBindings(),
      bits: { apply: (v, ms) => rampParam(this.ctx, this.node.parameters.get("bits")!, v as number, ms) },
      downsample: { apply: (v, ms) => rampParam(this.ctx, this.node.parameters.get("downsample")!, v as number, ms) },
    };
  }

  protected teardown(): void {
    this.node.disconnect();
  }
}
