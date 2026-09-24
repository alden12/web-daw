/**
 * Analog-style oscillator AudioWorkletProcessor (INST-15.2): the realtime shell around the pure
 * PolyBLEP `oscillators` DSP, the same oscillators Nimbus runs, exposed as the graph's `analogOsc`.
 *
 * It plays while its gate - a constant source at 1 the voice starts and stops with the note - is
 * up, starting from phase 0 when it first rises, and outputs silence otherwise. It reads the gate's
 * value, not whether it is connected: a source not yet started still feeds its input, with zeros. `frequency`,
 * `detune` and `pulseWidth` are a-rate, so an LFO into `pulseWidth` is pulse-width modulation;
 * `shape` (0 saw, 1 pulse) is the waveform, set by the graph rather than modulated.
 */
import { polyBlepPulse, polyBlepSaw } from "../dsp/oscillators";
import { isTransient, lifetime } from "./lifetime";

/** Keep a pulse from vanishing at the extremes of its width, where it would be silence. */
const MIN_WIDTH = 0.02;

class AnalogOscProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: "frequency", defaultValue: 440, minValue: 0, maxValue: 22050, automationRate: "a-rate" },
      { name: "detune", defaultValue: 0, minValue: -9600, maxValue: 9600, automationRate: "a-rate" },
      { name: "pulseWidth", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "a-rate" },
      { name: "shape", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  private phase = 0;
  private readonly alive: ReturnType<typeof lifetime>;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    this.alive = lifetime(isTransient(options));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const gate = inputs[0];
    const output = outputs[0]?.[0];
    if (!output) return this.alive(gate);
    const level = gate?.[0];
    if (!level) {
      output.fill(0);
      return this.alive(gate);
    }
    const { frequency, detune, pulseWidth } = parameters;
    const pulse = parameters.shape[0] >= 0.5;
    // An a-rate parameter holds one value for the whole block when it is not moving.
    const valueAt = (values: Float32Array, index: number) => (values.length > 1 ? values[index] : values[0]);
    for (let index = 0; index < output.length; index++) {
      if (level[index] <= 0) {
        output[index] = 0;
        continue;
      }
      const hz = valueAt(frequency, index) * Math.pow(2, valueAt(detune, index) / 1200);
      const step = Math.min(0.5, Math.max(0, hz / sampleRate));
      const width = Math.min(1 - MIN_WIDTH, Math.max(MIN_WIDTH, valueAt(pulseWidth, index)));
      output[index] = pulse ? polyBlepPulse(this.phase, step, width) : polyBlepSaw(this.phase, step);
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
    }
    return this.alive(gate);
  }
}

registerProcessor("analog-osc-processor", AnalogOscProcessor);
