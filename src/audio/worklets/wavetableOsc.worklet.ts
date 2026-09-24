/**
 * Wavetable oscillator AudioWorkletProcessor (INST-15.3): the realtime shell around the pure
 * `wavetable` DSP, exposed as the graph's `wavetableOsc`. `position` (a-rate) morphs through the
 * chosen bank of single-cycle waveforms; `bank` (k-rate, an index into WAVETABLE_BANKS) picks it.
 *
 * The banks are built once, when the module loads, and shared by every voice: building them per
 * note would stall the audio thread each time one starts.
 *
 * Like `analogOsc` it plays while its gate - a constant source at 1 the voice starts and stops with
 * the note - is up, from phase 0, and outputs silence otherwise.
 */
import { buildBanks, sampleTable } from "../dsp/wavetable";
import { keepAlive } from "./lifetime";

const BANKS = buildBanks();

class WavetableOscProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "frequency", defaultValue: 440, minValue: 0, maxValue: 22050, automationRate: "a-rate" },
      { name: "detune", defaultValue: 0, minValue: -9600, maxValue: 9600, automationRate: "a-rate" },
      { name: "position", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "bank", defaultValue: 0, minValue: 0, maxValue: BANKS.length - 1, automationRate: "k-rate" },
    ];
  }

  private phase = 0;
  private readonly alive = keepAlive();

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const gate = inputs[0];
    const output = outputs[0]?.[0];
    if (!output) return this.alive(gate);
    const level = gate?.[0];
    if (!level) {
      output.fill(0);
      return this.alive(gate);
    }
    const { frequency, detune, position } = parameters;
    const tables = BANKS[Math.min(BANKS.length - 1, Math.max(0, Math.round(parameters.bank[0])))];
    // An a-rate parameter holds one value for the whole block when it is not moving.
    const valueAt = (values: Float32Array, index: number) => (values.length > 1 ? values[index] : values[0]);
    for (let index = 0; index < output.length; index++) {
      if (level[index] <= 0) {
        output[index] = 0;
        continue;
      }
      const hz = valueAt(frequency, index) * Math.pow(2, valueAt(detune, index) / 1200);
      output[index] = sampleTable(tables, valueAt(position, index), this.phase);
      this.phase += Math.min(0.5, Math.max(0, hz / sampleRate));
      if (this.phase >= 1) this.phase -= 1;
    }
    return this.alive(gate);
  }
}

registerProcessor("wavetable-osc-processor", WavetableOscProcessor);
