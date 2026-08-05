import { describe, expect, it } from "vitest";
import {
  PITCH_CLASSES,
  SCALES,
  SCALE_NAMES,
  accidentalWidth,
  intervalLabel,
  padRows,
  pitchAt,
  type ScaleName,
} from "../src/audio/theory/scales";
import { pitchName } from "../src/audio/params/noteName";

/** The C major row on a phone: one octave, accidentals on. */
const cMajor = (overrides: Partial<Parameters<typeof padRows>[0]> = {}) =>
  padRows({
    tonic: 0,
    scale: "major",
    lowOctave: 3,
    octaves: 1,
    octavesPerRow: 1,
    accidentals: true,
    ...overrides,
  });

describe("pitchAt", () => {
  it("agrees with the roll's octave numbering", () => {
    expect(pitchAt(0, 4)).toBe(60);
    expect(pitchName(pitchAt(0, 4))).toBe("C4");
    expect(pitchName(pitchAt(9, 3))).toBe("A3");
  });
});

describe("intervalLabel", () => {
  it("names the distance, not the note", () => {
    expect(intervalLabel(0)).toBe("1");
    expect(intervalLabel(3)).toBe("b3");
    expect(intervalLabel(7)).toBe("5");
  });

  it("wraps, so an interval an octave up reads the same", () => {
    expect(intervalLabel(12)).toBe("1");
    expect(intervalLabel(19)).toBe("5");
  });
});

describe("padRows", () => {
  it("closes the row on the next tonic", () => {
    // Without it the leading tone has no gap above it and vanishes from the layout.
    const [row] = cMajor();
    expect(row.pitches.map((pad) => pitchName(pad.pitch))).toEqual(["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]);
  });

  it("lands C major's accidentals exactly where the black keys are", () => {
    // The gaps are derived from the interval pattern, so this is a consequence rather
    // than a special case - but it is the consequence that says the derivation is right.
    const [row] = cMajor();
    expect(row.accidentals.map((pad) => ({ name: pitchName(pad.pitch), center: pad.center }))).toEqual([
      { name: "C#3", center: 1 },
      { name: "D#3", center: 2 },
      { name: "F#3", center: 4 },
      { name: "G#3", center: 5 },
      { name: "A#3", center: 6 },
    ]);
  });

  it("holds its shape in any key: only the labels move", () => {
    const shapeOf = (rows: ReturnType<typeof padRows>) =>
      rows.map((row) => ({
        intervals: row.pitches.map((pad) => pad.interval),
        centers: row.accidentals.map((pad) => pad.center),
      }));
    PITCH_CLASSES.forEach((_name, tonic) => {
      expect(shapeOf(cMajor({ tonic }))).toEqual(shapeOf(cMajor()));
    });
    // ...and the pitches move with the tonic, a semitone at a time.
    expect(cMajor({ tonic: 2 })[0].pitches[0].pitch - cMajor()[0].pitches[0].pitch).toBe(2);
  });

  it("spreads two accidentals sharing one gap around the seam", () => {
    // A minor pentatonic leaves a three-semitone gap between the tonic and the b3, which
    // holds two accidentals. Stacked on the seam they would be one unplayable pad.
    const [row] = cMajor({ scale: "minor pentatonic" });
    const inFirstGap = row.accidentals.filter((pad) => Math.round(pad.center) === 1);
    expect(inFirstGap.map((pad) => pitchName(pad.pitch))).toEqual(["C#3", "D3"]);
    expect(inFirstGap[1].center - inFirstGap[0].center).toBeCloseTo(accidentalWidth);
    // Straddling the seam, so the pair stays centred on the gap it belongs to.
    expect((inFirstGap[0].center + inFirstGap[1].center) / 2).toBeCloseTo(1);
  });

  it("keeps every accidental inside the row it belongs to", () => {
    SCALE_NAMES.forEach((scale) => {
      const [row] = cMajor({ scale });
      row.accidentals.forEach((pad) => {
        expect(pad.center - accidentalWidth / 2).toBeGreaterThanOrEqual(0);
        expect(pad.center + accidentalWidth / 2).toBeLessThanOrEqual(row.pitches.length);
      });
    });
  });

  it("covers all twelve notes exactly once per octave, whatever the scale", () => {
    SCALE_NAMES.forEach((scale) => {
      const [row] = cMajor({ scale });
      // The closing tonic is the row's only duplicate pitch class, by design.
      const pitches = [...row.pitches.slice(0, -1), ...row.accidentals].map((pad) => pad.pitch);
      expect([...pitches].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 12 }, (_unused, semitones) => pitchAt(0, 3) + semitones),
      );
    });
  });

  it("gives a row per octave on a phone, and half as many on a tablet", () => {
    expect(cMajor({ octaves: 2 })).toHaveLength(2);
    expect(cMajor({ octaves: 2, octavesPerRow: 2 })).toHaveLength(1);
    // A two-octave row is still one row that closes on a tonic: 7 + 7 + 1.
    expect(cMajor({ octaves: 2, octavesPerRow: 2 })[0].pitches).toHaveLength(15);
  });

  it("stacks rows an octave apart, low first", () => {
    const [low, high] = cMajor({ octaves: 2 });
    expect(high.pitches[0].pitch - low.pitches[0].pitch).toBe(12);
  });

  it("leaves an odd octave as a short last row rather than overshooting the range", () => {
    const rows = cMajor({ octaves: 3, octavesPerRow: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[1].pitches).toHaveLength(SCALES.major.length + 1);
  });

  it("gives a row you cannot play a wrong note in when accidentals are off", () => {
    const [row] = cMajor({ accidentals: false });
    expect(row.accidentals).toEqual([]);
    expect(row.pitches).toHaveLength(SCALES.major.length + 1);
  });

  it("labels every pad by its interval to the tonic", () => {
    const [row] = cMajor({ tonic: 7, scale: "minor" });
    expect(row.pitches.map((pad) => pad.interval)).toEqual(["1", "2", "b3", "4", "5", "b6", "b7", "1"]);
  });
});

describe("SCALES", () => {
  it("starts every scale on the tonic and keeps it inside one octave, ascending", () => {
    SCALE_NAMES.forEach((name) => {
      const intervals = SCALES[name as ScaleName];
      expect(intervals[0]).toBe(0);
      expect(intervals[intervals.length - 1]).toBeLessThan(12);
      expect([...intervals].sort((a, b) => a - b)).toEqual([...intervals]);
    });
  });

  it("keeps every scale playable at ~44px on a phone", () => {
    // A row is the scale plus its closing tonic; below ~44px per pad the layout is wrong
    // rather than merely tight, and a 390px phone is the narrowest the app supports.
    SCALE_NAMES.forEach((name) => {
      expect(390 / (SCALES[name as ScaleName].length + 1)).toBeGreaterThanOrEqual(44);
    });
  });
});
