import { describe, expect, it } from "vitest";
import { DEFAULT_CHORD_PREFS } from "../src/audio/theory/chordPrefs";
import { isAccidentalRow, keyboardRows, padsByCode, qwertyLabel } from "../src/ui/keys/keyLayout";

type Options = Parameters<typeof keyboardRows>[0];

/** C major from C3 across the whole keyboard, notes unless asked. */
const layout = (overrides: Partial<Options> = {}) =>
  keyboardRows({
    tonic: 0,
    scale: "major",
    lowOctave: 3,
    rowMode: "octaves",
    raised: false,
    chords: false,
    prefs: DEFAULT_CHORD_PREFS,
    editing: false,
    ...overrides,
  });

const pitchesOf = (code: string, overrides: Partial<Options> = {}) => padsByCode(layout(overrides)).get(code)?.pitches;

describe("keyboardRows, notes", () => {
  it("plays the scale along each row, an octave a row, from the bottom", () => {
    // Z is the tonic, the eighth key closes the octave, and the last two reach past it.
    expect(layout()[0].map((cell) => cell.pad?.pitches[0])).toEqual([48, 50, 52, 53, 55, 57, 59, 60, 62, 64]);
    expect(pitchesOf("KeyA")).toEqual([60]);
    expect(pitchesOf("KeyQ")).toEqual([72]);
    expect(pitchesOf("Digit1")).toEqual([84]);
  });

  it("labels each key with its interval, and marks the tonics", () => {
    const row = layout()[0];
    expect(row.map((cell) => cell.pad?.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "1", "2", "3"]);
    expect(row.filter((cell) => cell.pad?.tone === "tonic").map((cell) => cell.code)).toEqual(["KeyZ", "Comma"]);
  });

  it("follows the key and the scale", () => {
    // A minor pentatonic: five notes, so a row of ten is two octaves.
    expect(layout({ tonic: 9, scale: "minor pentatonic" })[0].map((cell) => cell.pad?.pitches[0])).toEqual([
      57, 60, 62, 64, 67, 69, 72, 74, 76, 79,
    ]);
  });
});

describe("keyboardRows, raised and accidental rows", () => {
  it("turns each key into its own note's sharp while Shift is held, and blanks the keys without one", () => {
    const row = layout({ raised: true })[0];
    // C D E F G A B C D E -> C# D# - F# G# A# - C# D# -
    expect(row.map((cell) => cell.pad?.pitches[0] ?? null)).toEqual([49, 51, null, 54, 56, 58, null, 61, 63, null]);
    expect(row.flatMap((cell) => (cell.pad ? [cell.pad.tone] : [])).every((tone) => tone === "accidental")).toBe(true);
    expect(isAccidentalRow(0, { chords: false, rowMode: "octaves" })).toBe(false);
  });

  it("puts each note's sharp up and to its right, and leaves a gap where the scale has none", () => {
    const rows = layout({ rowMode: "accidentals" });
    expect(rows[0].slice(0, 8).map((cell) => cell.pad?.pitches[0])).toEqual([48, 50, 52, 53, 55, 57, 59, 60]);
    // - C# D# - F# G# A# - C#: a piano's black keys, each up and to the right of the note it sharpens.
    expect(rows[1].slice(0, 9).map((cell) => cell.pad?.pitches[0] ?? null)).toEqual([
      null,
      49,
      51,
      null,
      54,
      56,
      58,
      null,
      61,
    ]);
    expect(pitchesOf("KeyQ", { rowMode: "accidentals" })).toEqual([60]);
    expect(pitchesOf("KeyS", { rowMode: "accidentals" })).toEqual([49]);
    expect(pitchesOf("KeyA", { rowMode: "accidentals" })).toBeUndefined();
    expect(pitchesOf("Digit2", { rowMode: "accidentals" })).toEqual([61]);
  });
});

describe("keyboardRows, chords", () => {
  it("puts the triads on the bottom row and the variations above", () => {
    const rows = layout({ chords: true });
    expect(rows[0].map((cell) => cell.pad?.name ?? null)).toEqual([
      "C",
      "Dm",
      "Em",
      "F",
      "G",
      "Am",
      "B°",
      "C",
      null,
      null,
    ]);
    expect(pitchesOf("KeyZ", { chords: true })).toEqual([48, 52, 55]);
    expect(rows[1][0].pad?.name).toBe("Cmaj7");
  });
});

describe("qwertyLabel", () => {
  it("prints letters, digits and punctuation", () => {
    expect(["KeyZ", "Digit0", "Comma", "Semicolon", "Slash"].map(qwertyLabel)).toEqual(["Z", "0", ",", ";", "/"]);
  });
});
