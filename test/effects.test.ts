import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { ParamStore } from "../src/audio/params/store";
import { effectInfos, effectSchema } from "../src/audio/effects/catalog";
import { createEffect } from "../src/audio/effects/registry";

/**
 * Fake Web Audio context. `connect(undefined)` throws like the real API, so an
 * effect that wires its wet path to an undefined node (the subclass-field-clobber
 * bug) fails here instead of going silent in the browser. Construction alone
 * applies every binding once (bindParams), so the curve/impulse/delayTime paths
 * are all exercised.
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
function fakeCtx() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    createGain: () => fakeNode({ gain: fakeParam() }),
    createOscillator: () =>
      fakeNode({ type: "sine", frequency: fakeParam(), detune: fakeParam(), start() {}, stop() {}, onended: null }),
    createBiquadFilter: () => fakeNode({ type: "lowpass", frequency: fakeParam(), Q: fakeParam() }),
    createDelay: () => fakeNode({ delayTime: fakeParam() }),
    createWaveShaper: () => fakeNode({ curve: null, oversample: "none" }),
    createConvolver: () => fakeNode({ buffer: null }),
    createBuffer: (channels: number, length: number) => ({
      numberOfChannels: channels,
      getChannelData: () => new Float32Array(length),
    }),
  };
}

/**
 * Worklet-based effects construct a global `AudioWorkletNode` (not a ctx method), so
 * stub it for the catalog-iterating construction test - the worklet's own DSP is
 * covered separately in bitcrush.test.ts. Its `parameters` map returns fakeParams so
 * the bindings' rampParam calls run, like every other effect's.
 */
beforeAll(() => {
  class FakeAudioWorkletNode {
    parameters = new Map([
      ["bits", fakeParam()],
      ["downsample", fakeParam()],
    ]);
    connect(dest: unknown) {
      if (!dest) throw new TypeError("connect() to undefined destination");
      return dest;
    }
    disconnect() {}
  }
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
});
afterAll(() => delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode);

describe("effects", () => {
  for (const { type } of effectInfos()) {
    it(`${type}: constructs with input/output and applies bindings without wiring to undefined`, () => {
      const store = new ParamStore(effectSchema(type));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fx = createEffect(type, fakeCtx() as any, store);

      expect(fx.input).toBeTruthy();
      expect(fx.output).toBeTruthy();

      // Drive each param through a real change (different from default) so the
      // binding's apply runs again on a value, not just at construction.
      for (const spec of effectSchema(type)) {
        if (spec.kind !== "number") continue;
        const next = spec.default === spec.min ? spec.max : spec.min;
        expect(() => store.set(spec.id, next)).not.toThrow();
      }
      expect(() => fx.dispose()).not.toThrow();
    });
  }

  it("every effect schema includes a mix param", () => {
    for (const def of effectInfos()) {
      expect(def.schema.some((s) => s.id === "mix")).toBe(true);
    }
  });
});
