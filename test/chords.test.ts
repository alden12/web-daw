import { describe, expect, it } from "vitest";
import { DEFAULT_CHORD_ORDER, chordRowLimit, chordRows, type ChordFamily } from "../src/audio/theory/chords";
import { SCALES, SCALE_NAMES, type ScaleName } from "../src/audio/theory/scales";

const layout = (overrides: Partial<Parameters<typeof chordRows>[0]> = {}) =>
  chordRows({ tonic: 0, scale: "major", lowOctave: 3, rows: 1, order: DEFAULT_CHORD_ORDER, ...overrides });

const names = (row: ReturnType<typeof layout>[number]) => row.map((pad) => pad?.name ?? null);

describe("chordRows", () => {
  it("puts each degree's triad on the base row, closing on the tonic an octave up", () => {
    const [base] = layout();
    expect(names(base)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "B°", "C"]);
    expect(base.map((pad) => pad?.caption)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°", "I"]);
    expect(base[0]?.pitches).toEqual([48, 52, 55]);
    expect(base[7]?.pitches).toEqual([60, 64, 67]);
  });

  it("stacks each family above in the order given, with the quality that fits the degree", () => {
    const [, sevenths] = layout({ rows: 2 });
    expect(names(sevenths)).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7♭5", "Cmaj7"]);
    expect(sevenths[4]?.caption).toBe("7th");
  });

  it("skips a family on a degree it takes a note outside the key for, so the column moves up", () => {
    const order: ChordFamily[] = ["sus4", "firstInversion"];
    const [, second, third] = layout({ rows: 3, order });
    // F sus4 needs a Bb: F moves straight on to its inversion.
    expect(second[3]?.name).toBe("F/A");
    expect(third[3]).toBeNull();
    expect(second[0]?.name).toBe("Csus4");
    expect(third[0]?.name).toBe("C/E");
  });

  it("follows the ranking: move a family up and it takes a lower row", () => {
    const [, first] = layout({ rows: 2, order: ["sus2", "seventh"] });
    expect(first[0]?.name).toBe("Csus2");
  });

  it("writes an inversion over its bass note and raises the moved notes an octave", () => {
    const [, first, second] = layout({ rows: 3, order: ["firstInversion", "secondInversion"] });
    expect(first[2]).toMatchObject({ name: "Em/G", pitches: [55, 59, 64] });
    expect(second[2]).toMatchObject({ name: "Em/B", pitches: [59, 64, 67] });
  });

  it("transposes with the octave", () => {
    expect(layout({ lowOctave: 4 })[0][0]?.pitches).toEqual([60, 64, 67]);
  });

  it("never offers a note outside the scale, in any scale or key", () => {
    SCALE_NAMES.forEach((scale: ScaleName) =>
      [0, 5, 10].forEach((tonic) => {
        const inScale = new Set(SCALES[scale].map((interval) => (tonic + interval) % 12));
        layout({ scale, tonic, rows: chordRowLimit(DEFAULT_CHORD_ORDER) })
          .flat()
          .forEach((pad) => pad?.pitches.forEach((pitch) => expect(inScale.has(pitch % 12)).toBe(true)));
      }),
    );
  });

  it("gives a pentatonic degree with no triad the first family that fits, and a gap where none does", () => {
    const [base] = layout({ scale: "major pentatonic" });
    // E G B needs the B C major pentatonic leaves out, and no other shape fits on E either.
    expect(names(base)).toEqual(["C", "Dsus4", null, "Gsus4", "Am", "C"]);
  });
});
