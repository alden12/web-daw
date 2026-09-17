import { describe, it, expect } from "vitest";
import { applyTransform, type MidiTransform, type TransformContext } from "../src/audio/midi/device/transform";
import { octavator } from "../src/audio/midi/device/devices/octavator";

/** A context whose readParam returns from a plain value map. */
const ctx = (values: Record<string, number | boolean | string>): TransformContext => ({
  readParam: (id) => values[id],
});

describe("applyTransform (fan-out tap)", () => {
  it("emits one note per tap, offsetting pitch/velocity/beats", () => {
    const transform: MidiTransform = {
      kind: "tap",
      taps: [{ semitones: 0 }, { semitones: 7, velocityScale: 0.5, beats: 0.25 }],
    };
    expect(applyTransform(transform, 60, 1, ctx({}))).toEqual([
      { midi: 60, velocity: 1, beats: 0 },
      { midi: 67, velocity: 0.5, beats: 0.25 },
    ]);
  });

  it("skips a tap whose boolean gate resolves false", () => {
    const transform: MidiTransform = {
      kind: "tap",
      taps: [{ semitones: 0 }, { semitones: 12, enabled: { param: "on" } }],
    };
    expect(applyTransform(transform, 60, 1, ctx({ on: false })).map((note) => note.midi)).toEqual([60]);
    expect(applyTransform(transform, 60, 1, ctx({ on: true })).map((note) => note.midi)).toEqual([60, 72]);
  });

  it("resolves param-bound velocity scale", () => {
    const transform: MidiTransform = { kind: "tap", taps: [{ semitones: 12, velocityScale: { param: "level" } }] };
    expect(applyTransform(transform, 60, 0.8, ctx({ level: 0.5 }))[0].velocity).toBeCloseTo(0.4);
  });

  it("drops notes shifted outside the MIDI range", () => {
    const transform: MidiTransform = { kind: "tap", taps: [{ semitones: 0 }, { semitones: 12 }] };
    // 120 + 12 = 132 is out of range and dropped; the dry note survives.
    expect(applyTransform(transform, 120, 1, ctx({})).map((note) => note.midi)).toEqual([120]);
  });
});

describe("octavator device", () => {
  const values = (over: Record<string, number | boolean> = {}) =>
    ctx({ octaveUp: true, octaveDown: false, level: 0.7, ...over });

  it("passes the dry note and adds an octave up at scaled velocity by default", () => {
    expect(applyTransform(octavator.transform, 60, 1, values())).toEqual([
      { midi: 60, velocity: 1, beats: 0 },
      { midi: 72, velocity: 0.7, beats: 0 },
    ]);
  });

  it("adds the octave below when octaveDown is on", () => {
    expect(applyTransform(octavator.transform, 60, 1, values({ octaveDown: true })).map((note) => note.midi)).toEqual([
      60, 72, 48,
    ]);
  });

  it("passes only the dry note when both octaves are off", () => {
    expect(
      applyTransform(octavator.transform, 60, 1, values({ octaveUp: false, octaveDown: false })).map(
        (note) => note.midi,
      ),
    ).toEqual([60]);
  });
});
