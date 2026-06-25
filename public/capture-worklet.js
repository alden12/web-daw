/**
 * Capture worklet: copies the input's first channel (mono) to the main thread,
 * one render quantum (128 frames) at a time. The main thread (AudioEngine)
 * accumulates the chunks and assembles a WAV on stop. Posting per quantum (no
 * SharedArrayBuffer) keeps it simple and avoids cross-origin isolation; the
 * worklet only receives input while a recording is in progress (the engine
 * connects the source -> this node only during capture).
 */
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true; // keep the processor alive between recordings
  }
}

registerProcessor("capture-processor", CaptureProcessor);
