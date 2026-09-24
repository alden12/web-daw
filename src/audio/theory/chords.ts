/**
 * Chords in a key, for the chord pads (MOBILE-12, the model half of DAW-12.1). Pure and
 * DOM-free, so the computer keyboard and the agent tools can reach for the same vocabulary.
 *
 * **One rule decides which chords a key offers: every note has to be in the scale.** There is
 * no official list of "the variations that sound good" per degree, but that rule is the one a
 * list would be built from, and it works for any scale - a mode, harmonic minor, a pentatonic -
 * without a table per scale. A shape is tried on each degree and kept where it fits: sus4 fits
 * on C in C major (C F G) and not on F (F Bb C), so each degree gets its own set.
 *
 * A **family** is what you rank, not a single chord: "7th" means whichever seventh chord the
 * degree takes (Cmaj7, Dm7, G7, Bm7b5), because only one of them ever fits a given degree of a
 * seven-note scale. The base row is always the triad; the rows above are the families in the
 * order you rank them, each column taking the next one that fits its degree. Inversions of the
 * column's own chord fit wherever it does, so they fill a column that has run out of shapes -
 * and they are what stops a progression leaping around, which is the voicing question DAW-12.1
 * leaves open.
 */
import { PITCH_CLASSES, SCALES, pitchAt, type ScaleName } from "./scales";

/** A chord quality: the suffix it is written with, and its notes in semitones above the root. */
interface Quality {
  suffix: string;
  intervals: readonly number[];
  /** Written in lower case as a roman numeral (a minor or diminished chord). */
  minor?: boolean;
}

const QUALITY_TABLE = {
  major: { suffix: "", intervals: [0, 4, 7] },
  minor: { suffix: "m", intervals: [0, 3, 7], minor: true },
  diminished: { suffix: "°", intervals: [0, 3, 6], minor: true },
  augmented: { suffix: "+", intervals: [0, 4, 8] },
  major7: { suffix: "maj7", intervals: [0, 4, 7, 11] },
  dominant7: { suffix: "7", intervals: [0, 4, 7, 10] },
  minor7: { suffix: "m7", intervals: [0, 3, 7, 10], minor: true },
  halfDiminished: { suffix: "m7♭5", intervals: [0, 3, 6, 10], minor: true },
  diminished7: { suffix: "°7", intervals: [0, 3, 6, 9], minor: true },
  minorMajor7: { suffix: "m(maj7)", intervals: [0, 3, 7, 11], minor: true },
  augmentedMajor7: { suffix: "+maj7", intervals: [0, 4, 8, 11] },
  sus4: { suffix: "sus4", intervals: [0, 5, 7] },
  sus2: { suffix: "sus2", intervals: [0, 2, 7] },
  add9: { suffix: "add9", intervals: [0, 4, 7, 14] },
  minorAdd9: { suffix: "m(add9)", intervals: [0, 3, 7, 14], minor: true },
  sixth: { suffix: "6", intervals: [0, 4, 7, 9] },
  minorSixth: { suffix: "m6", intervals: [0, 3, 7, 9], minor: true },
  major9: { suffix: "maj9", intervals: [0, 4, 7, 11, 14] },
  dominant9: { suffix: "9", intervals: [0, 4, 7, 10, 14] },
  minor9: { suffix: "m9", intervals: [0, 3, 7, 10, 14], minor: true },
  power: { suffix: "5", intervals: [0, 7, 12] },
} as const satisfies Record<string, Quality>;

type QualityName = keyof typeof QUALITY_TABLE;
const QUALITIES: Record<QualityName, Quality> = QUALITY_TABLE;

interface Family {
  /** What the ranking and the pad's caption call it. */
  label: string;
  qualities?: readonly QualityName[];
  /** An inversion of the base chord: how many of its lowest notes move up an octave. */
  inversion?: number;
}

/**
 * The families you rank. Each lists the qualities it may be, and a degree takes the first one
 * whose notes are all in the scale. An inversion is of the column's base chord instead - the
 * same notes, the lowest one or two moved up an octave - so it has no qualities of its own.
 */
const FAMILY_TABLE = {
  seventh: {
    label: "7th",
    qualities: ["major7", "dominant7", "minor7", "halfDiminished", "diminished7", "minorMajor7", "augmentedMajor7"],
  },
  sus4: { label: "sus4", qualities: ["sus4"] },
  sus2: { label: "sus2", qualities: ["sus2"] },
  add9: { label: "add9", qualities: ["add9", "minorAdd9"] },
  sixth: { label: "6th", qualities: ["sixth", "minorSixth"] },
  firstInversion: { label: "1st inv", inversion: 1 },
  secondInversion: { label: "2nd inv", inversion: 2 },
  ninth: { label: "9th", qualities: ["major9", "dominant9", "minor9"] },
  power: { label: "power", qualities: ["power"] },
} as const satisfies Record<string, Family>;

export type ChordFamily = keyof typeof FAMILY_TABLE;
export const CHORD_FAMILIES: Record<ChordFamily, Family> = FAMILY_TABLE;

/** The default ranking, most useful first: the colours people reach for, then the voicings. */
export const DEFAULT_CHORD_ORDER = Object.keys(FAMILY_TABLE) as ChordFamily[];

/** The base row's qualities, tried in order: exactly one fits each degree of a major-scale mode. */
const TRIADS: readonly QualityName[] = ["major", "minor", "diminished", "augmented"];

export interface ChordPad {
  /** MIDI pitches, low to high. */
  pitches: number[];
  /** As it is written: `Cmaj7`, `Em/G`. */
  name: string;
  /** The line under it: the degree as a roman numeral on the base row, the family above it. */
  caption: string;
}

export interface ChordLayoutOptions {
  /** Tonic pitch class, 0..11. */
  tonic: number;
  scale: ScaleName;
  /** Octave of the first column's root, in the roll's numbering (C4 = 60). */
  lowOctave: number;
  /** Rows on show, the base row included. */
  rows: number;
  /** The families, most wanted first. */
  order: readonly ChordFamily[];
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * The chord pads for a key, **low row first**: row 0 is each degree's triad, and each row
 * above takes the next family in `order` that fits the degree. A column that has run out of
 * families has a gap (null) rather than a chord out of the key.
 *
 * One column per degree plus the tonic an octave up, closing the row as the note pads' does.
 */
export function chordRows({ tonic, scale, lowOctave, rows, order }: ChordLayoutOptions): (ChordPad | null)[][] {
  const intervals: readonly number[] = SCALES[scale];
  const inScale = new Set(intervals.map((interval) => (tonic + interval) % 12));
  const fits = (root: number, quality: QualityName) =>
    QUALITIES[quality].intervals.every((interval) => inScale.has((root + interval) % 12));
  const low = pitchAt(tonic, lowOctave);

  const degrees = [...intervals.map((interval, degree) => ({ interval, degree })), { interval: 12, degree: 0 }];
  const columns = degrees.map(({ interval, degree }) => {
    const root = low + interval;
    // A pentatonic's degrees do not all take a triad; the first family that fits stands in.
    const base =
      TRIADS.find((quality) => fits(root, quality)) ??
      order.flatMap((family) => familyQualities(family)).find((quality) => fits(root, quality));
    if (!base) return [];
    const baseChord = chordOf(root, base);
    const variations = order.flatMap((family): ChordPad[] => {
      const { label, inversion } = CHORD_FAMILIES[family];
      if (inversion) return [{ ...invert(baseChord, inversion, root), caption: label }];
      const quality = familyQualities(family).find((candidate) => candidate !== base && fits(root, candidate));
      return quality ? [{ ...chordOf(root, quality), caption: label }] : [];
    });
    const numeral = ROMAN[degree] + (QUALITIES[base].suffix === "°" ? "°" : "");
    return [{ ...baseChord, caption: QUALITIES[base].minor ? numeral.toLowerCase() : numeral }, ...variations];
  });

  return Array.from({ length: rows }, (_unused, row) => columns.map((column) => column[row] ?? null));
}

/** The most rows a key can fill: the base row, and one per family. */
export const chordRowLimit = (order: readonly ChordFamily[]) => 1 + order.length;

const familyQualities = (family: ChordFamily): readonly QualityName[] => CHORD_FAMILIES[family].qualities ?? [];

function chordOf(root: number, quality: QualityName): Omit<ChordPad, "caption"> {
  return {
    pitches: QUALITIES[quality].intervals.map((interval) => root + interval),
    name: PITCH_CLASSES[root % 12] + QUALITIES[quality].suffix,
  };
}

/** The chord with its lowest `count` notes moved up an octave, written over its new bass note. */
function invert(chord: Omit<ChordPad, "caption">, count: number, root: number): Omit<ChordPad, "caption"> {
  const pitches = [...chord.pitches.slice(count), ...chord.pitches.slice(0, count).map((pitch) => pitch + 12)];
  const bass = pitches[0] % 12;
  return { pitches, name: bass === root % 12 ? chord.name : `${chord.name}/${PITCH_CLASSES[bass]}` };
}
