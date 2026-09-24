/**
 * Custom-DSP blocks in the graph format (INST-15.1): the ladder and bitcrush kinds as data, the
 * voice cap an instrument using one gets, and what a voice does when a block's code is missing.
 * The DSP itself is covered in dsp.test.ts, and the sound in e2e/graph-worklets.e2e.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ParamStore } from "../src/audio/params/store";
import { GraphInstrument } from "../src/audio/graph/GraphInstrument";
import { parseInstrumentDef, parseEffectDef } from "../src/audio/graph/zod";
import { validateGraph, EFFECT_RESERVED } from "../src/audio/graph/validate";
import { WORKLET_KINDS, WORKLET_VOICE_CAP } from "../src/audio/graph/vocabulary";
import type { GraphInstrumentDef } from "../src/audio/graph/types";
import { bitcrusher } from "../src/audio/effects/graph/bitcrusher";

const fakeParam = () => ({
  value: 0,
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  setTargetAtTime() {},
  cancelScheduledValues() {},
});
const fakeNode = (extra: Record<string, unknown> = {}) => ({
  connect: (destination: unknown) => destination,
  disconnect() {},
  ...extra,
});

/** A context whose sources record when they are told to stop, so a stolen voice shows up. */
function fakeContext() {
  const stops: number[] = [];
  const source = (extra: Record<string, unknown>) =>
    fakeNode({ ...extra, start() {}, stop: (at: number) => stops.push(at), onended: null });
  const context = {
    currentTime: 0,
    sampleRate: 44100,
    createGain: () => fakeNode({ gain: fakeParam() }),
    createOscillator: () => source({ type: "sine", frequency: fakeParam(), detune: fakeParam() }),
    createConstantSource: () => source({ offset: fakeParam() }),
  };
  return { context, stops };
}

let workletsLoaded = true;
class FakeAudioWorkletNode {
  parameters = new Map(
    ["frequency", "resonance", "detune", "bits", "downsample", "pulseWidth", "shape"].map((name) => [
      name,
      fakeParam(),
    ]),
  );
  constructor(_context: unknown, processor: string) {
    if (!workletsLoaded) throw new DOMException(`${processor} is not registered`, "InvalidStateError");
  }
  connect = (destination: unknown) => destination;
  disconnect() {}
}
beforeEach(() => {
  workletsLoaded = true;
  (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeAudioWorkletNode;
});
afterEach(() => void delete (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode);

const ladderSynth: GraphInstrumentDef = {
  type: "ci-ladder",
  schema: [{ id: "cutoff", label: "Cutoff", kind: "number", min: 20, max: 20000, default: 800 }],
  voice: {
    nodes: [
      { id: "osc", kind: "osc", waveform: "sawtooth" },
      { id: "filter", kind: "ladder", frequency: { param: "cutoff" }, resonance: 0.5 },
      { id: "sweep", kind: "env", attack: 1, decay: 300, sustain: 0 },
      { id: "depth", kind: "gain", gain: 2400 },
    ],
    connections: [
      ["osc", "filter"],
      ["filter", "amp"],
      ["sweep", "depth"],
      ["depth", "filter.detune"],
    ],
  },
};

describe("custom-DSP kinds as data", () => {
  it("are analogOsc, ladder and bitcrush, and a def can bind and modulate their fields", () => {
    expect([...WORKLET_KINDS].sort()).toEqual(["analogOsc", "bitcrush", "ladder"]);
    expect(parseInstrumentDef(ladderSynth)).toMatchObject({ ok: true });
  });

  it("refuses a field a block does not have", () => {
    const def = structuredClone(ladderSynth);
    def.voice.connections.push(["depth", "filter.q"]);
    expect(parseInstrumentDef(def).ok).toBe(false);
  });

  it("the Bitcrusher is now a valid effect def", () => {
    expect(validateGraph(bitcrusher.schema, bitcrusher.graph, EFFECT_RESERVED)).toEqual([]);
    expect(parseEffectDef(bitcrusher).ok).toBe(true);
  });
});

describe("the voice cap for an instrument using a custom-DSP block", () => {
  it(`plays at most ${WORKLET_VOICE_CAP} notes, cutting the oldest in a few milliseconds for a new one`, () => {
    const { context, stops } = fakeContext();
    const synth = new GraphInstrument(context as never, new ParamStore(ladderSynth.schema), ladderSynth);
    for (let note = 0; note < WORKLET_VOICE_CAP; note++) synth.noteOn(48 + note, 1, 1);
    expect(stops).toEqual([]);
    synth.noteOn(60, 1, 2); // one past the cap
    // The oldest voice's two sources (osc, env) stop just after a short fade at the new note.
    expect(stops).toHaveLength(2);
    expect(stops.every((at) => at > 2 && at < 2.05)).toBe(true);
    // Letting go of the stolen note later is harmless: it is no longer held.
    expect(() => synth.noteOff(48, 3)).not.toThrow();
    expect(stops).toHaveLength(2);
  });

  it("takes a note already let go before one still held", () => {
    const { context, stops } = fakeContext();
    const synth = new GraphInstrument(context as never, new ParamStore(ladderSynth.schema), ladderSynth);
    for (let note = 0; note < WORKLET_VOICE_CAP; note++) synth.noteOn(48 + note, 1, 1);
    synth.noteOff(52, 1.5); // releasing, schedules its own stop
    const releaseStops = stops.length;
    synth.noteOn(60, 1, 2);
    // The released note is cut (its sources re-stopped near 2s), not note 48, the oldest held.
    expect(stops.slice(releaseStops).every((at) => at > 2 && at < 2.05)).toBe(true);
    synth.noteOff(48, 3); // still held, so this schedules a release
    expect(stops.length).toBeGreaterThan(releaseStops + 2);
  });

  it("does not cap an instrument made only of native nodes", () => {
    const { context, stops } = fakeContext();
    const native: GraphInstrumentDef = {
      type: "ci-native",
      schema: [],
      voice: { nodes: [{ id: "osc", kind: "osc" }], connections: [["osc", "amp"]] },
    };
    const synth = new GraphInstrument(context as never, new ParamStore([]), native);
    for (let note = 0; note < 20; note++) synth.noteOn(40 + note, 1, 1);
    expect(stops).toEqual([]);
  });
});

describe("a custom-DSP block whose code did not load", () => {
  it("passes audio through, so the voice still builds and plays, and warns once", () => {
    workletsLoaded = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { context } = fakeContext();
    const store = new ParamStore(ladderSynth.schema);
    const synth = new GraphInstrument(context as never, store, ladderSynth);
    expect(() => {
      synth.noteOn(60, 1, 0);
      synth.noteOn(62, 1, 0);
      store.set("cutoff", 2000);
    }).not.toThrow();
    expect(warn.mock.calls.filter(([message]) => String(message).includes("ladder-processor"))).toHaveLength(1);
    warn.mockRestore();
  });
});

describe("a custom-DSP processor's lifetime", () => {
  it("runs until input first arrives, then only while it lasts", async () => {
    const { keepAlive } = await import("../src/audio/worklets/lifetime");
    const alive = keepAlive();
    const silence: Float32Array[] = [];
    const playing = [new Float32Array(128)];
    expect([alive(silence), alive(silence), alive(playing), alive(playing), alive(silence)]).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("the analogOsc block", () => {
  const pwmSynth: GraphInstrumentDef = {
    type: "ci-pwm",
    schema: [{ id: "width", label: "Width", kind: "number", min: 0, max: 1, default: 0.3 }],
    voice: {
      nodes: [
        { id: "osc", kind: "analogOsc", waveform: "pulse", pulseWidth: { param: "width" }, noteRatio: 0.5 },
        { id: "lfo", kind: "osc", frequency: 3 },
        { id: "lfoDepth", kind: "gain", gain: 0.2 },
      ],
      connections: [
        ["osc", "amp"],
        ["lfo", "lfoDepth"],
        ["lfoDepth", "osc.pulseWidth"],
      ],
    },
  };

  it("is a source kind a def can bind and modulate, with its own waveforms", () => {
    expect(WORKLET_KINDS).toContain("analogOsc");
    expect(parseInstrumentDef(pwmSynth)).toMatchObject({ ok: true });
    const sine = structuredClone(pwmSynth);
    sine.voice.nodes[0] = { id: "osc", kind: "analogOsc", waveform: "sine" as never };
    expect(parseInstrumentDef(sine).ok).toBe(false);
  });

  it("starts and stops with the note through its gate, and counts towards the voice cap", () => {
    const { context, stops } = fakeContext();
    const synth = new GraphInstrument(context as never, new ParamStore(pwmSynth.schema), pwmSynth);
    synth.playNote(60, 0.5, 1, 1);
    // Two sources per voice: the oscillator's gate and the LFO, both stopped after the release.
    expect(stops).toHaveLength(2);
    for (let note = 0; note < WORKLET_VOICE_CAP; note++) synth.noteOn(40 + note, 1, 2);
    expect(stops.length).toBe(2 + 2); // the ninth note cut the oldest held one
  });

  it("falls back to a native oscillator when its code did not load, still following the note", () => {
    workletsLoaded = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const frequencies: number[] = [];
    const { context } = fakeContext();
    const withOscillator = {
      ...context,
      createOscillator: () => {
        const frequency = { ...fakeParam(), setValueAtTime: (value: number) => frequencies.push(value) };
        return fakeNode({ type: "sine", frequency, detune: fakeParam(), start() {}, stop() {}, onended: null });
      },
    };
    const synth = new GraphInstrument(withOscillator as never, new ParamStore(pwmSynth.schema), pwmSynth);
    expect(() => synth.noteOn(69, 1, 0)).not.toThrow();
    expect(frequencies).toContain(220); // A4 at noteRatio 0.5
    expect(warn.mock.calls.some(([message]) => String(message).includes("plain oscillator"))).toBe(true);
    warn.mockRestore();
  });
});
