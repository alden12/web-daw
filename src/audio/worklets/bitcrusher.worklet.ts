/**
 * Bitcrusher AudioWorkletProcessor: the realtime shell around the pure `bitcrush`
 * DSP. `bits` and `downsample` are k-rate AudioParams (so they smooth and automate
 * like any other effect param); per-channel sample-hold state is kept across render
 * quanta. Authored in TS and bundled by Vite (its `bitcrush` import is inlined), so
 * the exact math here is the same module the unit tests exercise.
 */
import { crushSample, makeHoldState, type HoldState } from '../dsp/bitcrush';

class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'bits', defaultValue: 8, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'downsample', defaultValue: 4, minValue: 1, maxValue: 50, automationRate: 'k-rate' },
    ];
  }

  private holds: HoldState[] = [];

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;
    // k-rate params arrive as a length-1 array (constant across the quantum).
    const bits = parameters.bits[0];
    const downsample = parameters.downsample[0];

    for (let ch = 0; ch < output.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!outCh) continue;
      const hold = this.holds[ch] ?? (this.holds[ch] = makeHoldState());
      if (!inCh) {
        outCh.fill(0);
        continue;
      }
      for (let i = 0; i < outCh.length; i++) {
        outCh[i] = crushSample(inCh[i], bits, downsample, hold);
      }
    }
    return true;
  }
}

registerProcessor('bitcrusher-processor', BitcrusherProcessor);
