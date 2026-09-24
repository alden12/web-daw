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
 *
 * **Two families step outside the key on purpose**, the two ways a pop or jazz progression
 * most often does, and both still hang off a degree of the scale so they have a column:
 * - **flip**, the column's triad with its third flipped: minor to major gives the secondary
 *   dominants (D, E and A in C major, each pulling to the chord a fifth below), and major to minor
 *   gives the chords borrowed from the parallel minor (Fm, the bittersweet iv).
 * - **V7 of**, a dominant seventh on the degree wherever it resolves to a chord of the key: C7, D7,
 *   E7, A7 and B7 in C major. Not F7, whose B♭ target is not in the key, and not G7, which is
 *   already the plain 7th.
 * Chords whose root is outside the scale (B♭, A♭ and E♭ in C major) have no column and are left out.
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
  minorMajor7: { suffix: "mM7", intervals: [0, 3, 7, 11], minor: true },
  augmentedMajor7: { suffix: "+maj7", intervals: [0, 4, 8, 11] },
  sus4: { suffix: "sus4", intervals: [0, 5, 7] },
  sus2: { suffix: "sus2", intervals: [0, 2, 7] },
  add9: { suffix: "add9", intervals: [0, 4, 7, 14] },
  minorAdd9: { suffix: "madd9", intervals: [0, 3, 7, 14], minor: true },
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
  /** A chord that steps outside the key on purpose (see the top of the file), built its own way. */
  outside?: "flip" | "dominantOf";
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
  flip: { label: "flip", outside: "flip" },
  dominantOf: { label: "V7 of", outside: "dominantOf" },
} as const satisfies Record<string, Family>;

export type ChordFamily = keyof typeof FAMILY_TABLE;
export const CHORD_FAMILIES: Record<ChordFamily, Family> = FAMILY_TABLE;

/** The default ranking, most useful first: the colours people reach for, then the voicings, then
 *  the chords from outside the key. */
export const DEFAULT_CHORD_ORDER = Object.keys(FAMILY_TABLE) as ChordFamily[];

/**
 * One column's own arrangement, or the global one. The arrangement types live here because the
 * layout reads them; chordPrefs.ts edits them, and says why they are shaped this way.
 */
export interface ChordArrangement {
  order: ChordFamily[];
  hidden: ChordFamily[];
}

export interface ChordPrefs extends ChordArrangement {
  /** By scale degree (0 = the tonic): the columns rearranged on their own. */
  columns: Record<number, ChordArrangement>;
  /** `degree:family` - `triad` included, which a star can tint but never move. */
  favourites: string[];
}

export const favouriteKey = (degree: number, family: ChordFamily | "triad") => `${degree}:${family}`;

/** A column's arrangement as it stands: its own, or the global one it follows. */
export const arrangementFor = (prefs: ChordPrefs, degree: number): ChordArrangement =>
  prefs.columns[degree] ?? { order: prefs.order, hidden: prefs.hidden };

/** The base row's qualities, tried in order: exactly one fits each degree of a major-scale mode. */
const TRIADS: readonly QualityName[] = ["major", "minor", "diminished", "augmented"];

/** A triad with its third flipped. Diminished has a flat fifth as well, so it flips to plain minor;
 *  augmented has no third to flip that keeps it a chord worth offering. */
const FLIPPED: Partial<Record<QualityName, QualityName>> = { major: "minor", minor: "major", diminished: "minor" };

export interface ChordPad {
  /** MIDI pitches, low to high. */
  pitches: number[];
  /** As it is written: `Cmaj7`, `Em/G`. */
  name: string;
  /** The line under it: the degree as a roman numeral on the base row, the family above it. */
  caption: string;
  /** Its scale degree (0 = the tonic, the closing column included) and family: what an edit names. */
  degree: number;
  family: ChordFamily | "triad";
  favourite: boolean;
  /** Hidden by the arrangement: only laid out while editing, so it can be shown again. */
  hidden: boolean;
  /** Has a note outside the key (the flip and V7-of families). */
  outside: boolean;
}

export interface ChordLayoutOptions {
  /** Tonic pitch class, 0..11. */
  tonic: number;
  scale: ScaleName;
  /** Octave of the first column's root, in the roll's numbering (C4 = 60). */
  lowOctave: number;
  /** How the columns are arranged: order, hidden and favourites (chordPrefs.ts). */
  prefs: ChordPrefs;
  /** Lay out hidden chords too (flagged), so the editor can show them again. */
  editing?: boolean;
  /** Exactly this many rows, the base row included; by default as many as the fullest column. */
  rows?: number;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/**
 * The chord pads for a key, **low row first**: row 0 is each degree's triad, and each row
 * above takes the next family in its column's order that fits the degree. A column that has run
 * out of families has a gap (null) rather than a chord out of the key.
 *
 * One column per degree plus the tonic an octave up, closing the row as the note pads' does.
 */
export function chordRows({
  tonic,
  scale,
  lowOctave,
  prefs,
  editing = false,
  rows,
}: ChordLayoutOptions): (ChordPad | null)[][] {
  const intervals: readonly number[] = SCALES[scale];
  const inScale = new Set(intervals.map((interval) => (tonic + interval) % 12));
  const fits = (root: number, quality: QualityName) =>
    QUALITIES[quality].intervals.every((interval) => inScale.has((root + interval) % 12));
  const low = pitchAt(tonic, lowOctave);
  const favourites = new Set(prefs.favourites);
  /** The triad on a pitch, when the key has one there: what a secondary dominant resolves to. */
  const triadOn = (root: number) => TRIADS.find((quality) => fits(root, quality));
  const numeral = (degree: number, quality: QualityName) =>
    QUALITIES[quality].minor
      ? ROMAN[degree].toLowerCase() + (quality === "diminished" ? "°" : "")
      : ROMAN[degree] + (quality === "augmented" ? "+" : "");
  /** "V/vi": the chord a fifth below `root`, as the key names it; null when the key has none there. */
  const resolvesTo = (root: number) => {
    const target = (root + 5) % 12;
    const degree = intervals.findIndex((interval) => (tonic + interval) % 12 === target);
    const quality = degree < 0 ? undefined : triadOn(target);
    return quality && quality !== "diminished" ? numeral(degree, quality) : null;
  };

  const degrees = [...intervals.map((interval, degree) => ({ interval, degree })), { interval: 12, degree: 0 }];
  const columns = degrees.map(({ interval, degree }): ChordPad[] => {
    const root = low + interval;
    const { order, hidden } = arrangementFor(prefs, degree);
    // A pentatonic's degrees do not all take a triad; the first family that fits stands in.
    const base =
      TRIADS.find((quality) => fits(root, quality)) ??
      order.flatMap((family) => familyQualities(family)).find((quality) => fits(root, quality));
    if (!base) return [];
    const baseChord = chordOf(root, base);
    const pad = (chord: Chord, caption: string, family: ChordFamily | "triad"): ChordPad => ({
      ...chord,
      caption,
      degree,
      family,
      favourite: favourites.has(favouriteKey(degree, family)),
      hidden: family !== "triad" && hidden.includes(family),
      outside: chord.pitches.some((pitch) => !inScale.has(pitch % 12)),
    });
    const outsideChord = (kind: "flip" | "dominantOf"): ChordPad[] => {
      if (kind === "dominantOf") {
        const target = resolvesTo(root);
        // Already in the key, it is the plain 7th (G7 in C major) rather than a borrowed one.
        return target && !fits(root, "dominant7") ? [pad(chordOf(root, "dominant7"), `V7/${target}`, kind)] : [];
      }
      const flipped = FLIPPED[base];
      if (!flipped) return [];
      const target = flipped === "major" ? resolvesTo(root) : null;
      return [pad(chordOf(root, flipped), target ? `V/${target}` : numeral(degree, flipped), kind)];
    };
    const variations = order.flatMap((family): ChordPad[] => {
      const { label, inversion, outside } = CHORD_FAMILIES[family];
      if (outside) return outsideChord(outside);
      if (inversion) return [pad(invert(baseChord, inversion, root), label, family)];
      const quality = familyQualities(family).find((candidate) => candidate !== base && fits(root, candidate));
      return quality ? [pad(chordOf(root, quality), label, family)] : [];
    });
    return [
      pad(baseChord, TRIADS.includes(base) ? numeral(degree, base) : ROMAN[degree], "triad"),
      ...variations.filter((variation) => editing || !variation.hidden),
    ];
  });

  const depth = rows ?? Math.max(1, ...columns.map((column) => column.length));
  return Array.from({ length: depth }, (_unused, row) => columns.map((column) => column[row] ?? null));
}

/** The most rows a key can fill: the base row, and one per family. */
export const CHORD_ROW_LIMIT = 1 + DEFAULT_CHORD_ORDER.length;

const familyQualities = (family: ChordFamily): readonly QualityName[] => CHORD_FAMILIES[family].qualities ?? [];

/** A chord's notes and name, before it is placed in a column. */
type Chord = Pick<ChordPad, "pitches" | "name">;

function chordOf(root: number, quality: QualityName): Chord {
  return {
    pitches: QUALITIES[quality].intervals.map((interval) => root + interval),
    name: PITCH_CLASSES[root % 12] + QUALITIES[quality].suffix,
  };
}

/** The chord with its lowest `count` notes moved up an octave, written over its new bass note. */
function invert(chord: Chord, count: number, root: number): Chord {
  const pitches = [...chord.pitches.slice(count), ...chord.pitches.slice(0, count).map((pitch) => pitch + 12)];
  const bass = pitches[0] % 12;
  return { pitches, name: bass === root % 12 ? chord.name : `${chord.name}/${PITCH_CLASSES[bass]}` };
}
