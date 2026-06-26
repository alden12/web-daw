/**
 * Capture AudioWorkletProcessor: copies the first input channel each render quantum
 * and posts it to the main thread as a transferable Float32Array (no params). Used by
 * the recorder to accumulate PCM. TS port of the former public/capture-worklet.js, so
 * recording rides the same Vite-bundled worklet path as every other processor.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
