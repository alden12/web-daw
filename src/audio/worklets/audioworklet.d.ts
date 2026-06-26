/**
 * Minimal ambient declarations for the AudioWorklet *global scope* (the side that
 * runs inside an AudioWorkletProcessor). TypeScript's DOM lib declares the
 * main-thread `AudioWorkletNode` but not the processor-side globals, and we author
 * worklets in TS, so declare just what our processors use. No dependency needed.
 */
interface AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
};

/** Descriptor for a processor's automatable params (subset we use). */
interface AudioParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}

declare function registerProcessor(
  name: string,
  processorCtor: (new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor) & {
    parameterDescriptors?: AudioParamDescriptor[];
  },
): void;

/** The worklet render quantum's sample rate (Hz), available in the global scope. */
declare const sampleRate: number;

/** The audio context's time (seconds) at the start of the current render quantum. */
declare const currentTime: number;
