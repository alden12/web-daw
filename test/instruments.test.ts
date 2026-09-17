import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { ParamStore } from "../src/audio/params/store";
import { instrumentSchema, pickableInstrumentInfos } from "../src/audio/instruments/catalog";
import { createInstrument } from "../src/audio/instruments/registry";

/**
 * A minimal fake Web Audio context. `connect(undefined)` throws like the real
 * API, which is what catches the "subclass field clobbered after super()" bug:
 * if an instrument tries to wire a voice to an undefined shared node, the test
 * fails instead of silently producing no sound in the browser.
 */
function fakeParam() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    setTargetAtTime() {},
    cancelAndHoldAtTime() {},
    cancelScheduledValues() {},
  };
}
function fakeNode(extra: Record<string, unknown> = {}) {
  return {
    connect(dest: unknown) {
      if (!dest) throw new TypeError("connect() to undefined destination");
      return dest;
    },
    disconnect() {},
    ...extra,
  };
}
function fakeBuffer(length: number, sampleRate: number) {
  return { length, sampleRate, duration: length / sampleRate, numberOfChannels: 1 };
}
function fakeCtx() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    createGain: () => fakeNode({ gain: fakeParam() }),
    createOscillator: () =>
      fakeNode({ type: "sine", frequency: fakeParam(), detune: fakeParam(), start() {}, stop() {}, onended: null }),
    createBiquadFilter: () => fakeNode({ type: "lowpass", frequency: fakeParam(), Q: fakeParam() }),
    // The sampler builds an AudioBufferSourceNode per voice and a silent buffer up front.
    createBufferSource: () =>
      fakeNode({ buffer: null, playbackRate: fakeParam(), start() {}, stop() {}, onended: null }),
    createBuffer: (_channels: number, length: number, sampleRate: number) => fakeBuffer(length, sampleRate),
  };
}

/**
 * Worklet-based instruments construct a global `AudioWorkletNode` (not a ctx method),
 * so stub it for the catalog-iterating construction test - the processor's DSP is
 * covered separately in wavetable.test.ts. `parameters.get` returns a fakeParam so the
 * generic binding's rampParam calls run; `port.postMessage` swallows note commands.
 */
beforeAll(() => {
  class FakeAudioWorkletNode {
    parameters = { get: () => fakeParam() };
    port = { postMessage() {} };
    connect(dest: unknown) {
      if (!dest) throw new TypeError("connect() to undefined destination");
      return dest;
    }
    disconnect() {}
  }
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
});
afterAll(() => delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode);

describe("instruments", () => {
  // The hidden "none" sentinel is silent (empty schema, no voices) - exclude it here.
  for (const { type } of pickableInstrumentInfos()) {
    it(`${type}: constructs and plays voices without wiring to an undefined node`, () => {
      const store = new ParamStore(instrumentSchema(type));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inst = createInstrument(type, fakeCtx() as any, store);

      expect(() => inst.playNote(60, 0.5, 0.8, 0)).not.toThrow();
      expect(() => {
        inst.noteOn(64, 0.8, 0);
        inst.noteOff(64, 0.5);
      }).not.toThrow();
      // a polyphonic chord
      expect(() => {
        inst.playNote(60, 1, 0.8, 0);
        inst.playNote(64, 1, 0.8, 0);
        inst.playNote(67, 1, 0.8, 0);
      }).not.toThrow();
      // param change drives a binding
      expect(() => store.set("amp.level", 0.5)).not.toThrow();
      expect(() => inst.allNotesOff()).not.toThrow();
    });
  }
});
