import { describe, expect, it } from "vitest";
import { capturePhrase } from "../src/audio/portraits/capturePhrase";
import { envelope, isSustained, phaseScope, phrase } from "../src/audio/portraits/draw";
import { midiDeviceInfos } from "../src/audio/midi/device/catalog";
import { exploreItems } from "../src/ui/explore/exploreItems";

const sine = (frequency: number, seconds: number, sampleRate = 8000, shape = (value: number) => value) =>
  Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, index) =>
    shape(Math.sin((2 * Math.PI * frequency * index) / sampleRate)),
  );
const numbers = (path: string) => [...path.matchAll(/-?\d+(\.\d+)?/g)].map((match) => Number(match[0]));

describe("capturePhrase", () => {
  it("captures something from every MIDI device, inside the phrase", () => {
    for (const info of midiDeviceInfos()) {
      const { notes, spanSec } = capturePhrase(info.type);
      expect(notes.length, info.type).toBeGreaterThan(0);
      expect(
        notes.every((note) => note.start >= 0 && note.start < spanSec),
        info.type,
      ).toBe(true);
    }
  });

  it("steps a generator through the phrase once, not twice at its start", () => {
    const { notes } = capturePhrase("arpeggiator");
    const starts = notes.map((note) => note.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect(Math.max(...starts)).toBeGreaterThan(1);
  });
});

describe("draw", () => {
  it("a pure tone's scope stays inside the box", () => {
    const values = numbers(phaseScope(sine(100, 1), 8000, 100));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...values)).toBeLessThanOrEqual(91);
  });

  it("tells a held sound from one that has died away", () => {
    const decaying = Float32Array.from(sine(100, 1), (value, index) => value * Math.exp(-index / 400));
    expect(isSustained(sine(100, 1), 8000)).toBe(true);
    expect(isSustained(decaying, 8000)).toBe(false);
  });

  it("an envelope is a closed, mirrored shape", () => {
    const path = envelope(sine(100, 0.5));
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  it("a phrase draws one block per note, and nothing for no notes", () => {
    expect(phrase([], 4)).toBe("");
    const blocks = phrase(
      [
        { pitch: 60, start: 0, length: 0.5 },
        { pitch: 64, start: 1, length: 0.5 },
      ],
      4,
    );
    expect(blocks.match(/M/g)).toHaveLength(2);
  });
});

describe("portraits.json", () => {
  it("has a portrait for every built-in (run `yarn portraits` after adding or retuning one)", () => {
    const missing = exploreItems({ savedPatches: [], samples: [] })
      .filter((item) => item.builtin && !item.portrait?.line && !item.portrait?.fill)
      .map((item) => item.key);
    expect(missing).toEqual([]);
  });
});
