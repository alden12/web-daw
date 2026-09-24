/**
 * Ladder filter AudioWorkletProcessor (INST-15): the realtime shell around the pure `ladder` DSP,
 * the same filter Nimbus runs, exposed as a graph node. `frequency`, `resonance` and `detune` are
 * a-rate parameters so an envelope or LFO wired into them moves the cutoff within a block; the
 * coefficients are recomputed per sample only while one of them is moving, else once per block.
 * Filter state is kept per channel across render quanta.
 *
 * Its lifetime follows its input (`keepAlive`): kept running until something first plays into it,
 * which in a voice is only when the note starts, then only while something still does, so it can
 * be collected once the voice's sources stop and disconnect.
 */
import { ladderCoeffs, ladderStep, makeLadderState, type LadderState } from "../dsp/ladder";
import { keepAlive } from "./lifetime";

/** Keep the cutoff where the ladder approximation stays stable and in tune. */
const MIN_CUTOFF = 20;
const MAX_CUTOFF_FRACTION = 0.45;

class LadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "frequency", defaultValue: 1000, minValue: 10, maxValue: 22050, automationRate: "a-rate" },
      { name: "resonance", defaultValue: 0.2, minValue: 0, maxValue: 1.2, automationRate: "a-rate" },
      { name: "detune", defaultValue: 0, minValue: -9600, maxValue: 9600, automationRate: "a-rate" },
    ];
  }

  private states: LadderState[] = [];
  private readonly alive = keepAlive();

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return this.alive(input);
    const { frequency, resonance, detune } = parameters;
    const moving = frequency.length > 1 || resonance.length > 1 || detune.length > 1;
    const maxCutoff = sampleRate * MAX_CUTOFF_FRACTION;
    // An a-rate parameter holds one value for the whole block when it is not moving.
    const valueAt = (values: Float32Array, index: number) => (values.length > 1 ? values[index] : values[0]);
    const coeffsAt = (index: number) => {
      const hz = valueAt(frequency, index) * Math.pow(2, valueAt(detune, index) / 1200);
      const cutoff = Math.min(maxCutoff, Math.max(MIN_CUTOFF, hz));
      return ladderCoeffs(cutoff, valueAt(resonance, index), sampleRate);
    };
    const steady = moving ? null : coeffsAt(0);

    for (let channel = 0; channel < output.length; channel++) {
      const inChannel = input[channel];
      const outChannel = output[channel];
      if (!outChannel) continue;
      if (!inChannel) {
        outChannel.fill(0);
        continue;
      }
      const state = this.states[channel] ?? (this.states[channel] = makeLadderState());
      for (let index = 0; index < outChannel.length; index++) {
        outChannel[index] = ladderStep(inChannel[index], steady ?? coeffsAt(index), state);
      }
    }
    return this.alive(input);
  }
}

registerProcessor("ladder-processor", LadderProcessor);
