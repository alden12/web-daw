/**
 * The "Popular" arrangement of the chord pads (MOBILE-12): per degree, the variations people reach
 * for most, first.
 *
 * **Curated, not measured.** There is real data on this - Hooktheory's analysis of thousands of pop
 * songs - but it is not open to use, so these tables encode well-established practice instead, and
 * they line up with that data where it has been published. Expect to tune them by ear: they are
 * data for exactly that reason, and a change is an edit to a list.
 *
 * **Keyed by semitones above the tonic, not by degree number**, so a scale with fewer notes lines
 * up: in a major pentatonic the fourth note is the V (7 semitones), and it gets the V's list rather
 * than the IV's. A column the table does not name follows the "Type" order.
 *
 * Two tables, **major and minor**, and each scale borrows the closer one (`POPULAR_TABLE_FOR`).
 * Anything a list leaves out follows it in the Type order, and a family that does not fit the
 * degree is skipped as always.
 */
import { DEFAULT_CHORD_ORDER, type ChordFamily, type ChordPrefs } from "./chords";
import { SCALES, type ScaleName } from "./scales";

type PopularTable = Partial<Record<number, ChordFamily[]>>;

const MAJOR: PopularTable = {
  // I: the colours of home - maj7, add9, the sus chords - and C/E for a bass that walks.
  0: ["seventh", "add9", "sus2", "sus4", "firstInversion", "sixth", "dominantOf"],
  // ii: m7 by a mile (the ii-V-I), then the flip to D, the V of V.
  2: ["seventh", "flip", "sus4", "sus2", "dominantOf", "add9", "ninth"],
  // iii: flipped to E, the V of vi and pop's favourite way into the relative minor.
  4: ["flip", "seventh", "dominantOf", "sus4", "firstInversion"],
  // IV: maj7 and add9, then Fm, the borrowed iv.
  5: ["seventh", "add9", "flip", "sus2", "sixth", "firstInversion"],
  // V: the 7 and the sus4 (G sus4 to G is everywhere), then G/B in a walking bass.
  7: ["seventh", "sus4", "firstInversion", "add9", "sus2", "ninth", "secondInversion"],
  // vi: m7 and the sus chords, then A, the V of ii.
  9: ["seventh", "sus4", "sus2", "add9", "flip", "dominantOf"],
  // vii°: the half-diminished 7th, then Bm and B7, which pull to iii.
  11: ["seventh", "flip", "dominantOf", "firstInversion"],
};

const MINOR: PopularTable = {
  // i: m7 and madd9, the sus chords, and the minor 6th's film-noir colour.
  0: ["seventh", "add9", "sus2", "sus4", "sixth", "firstInversion"],
  // ii°: m7♭5, the minor key's ii in a ii-V-i.
  2: ["seventh", "firstInversion", "flip"],
  // III: the relative major: maj7, add9.
  3: ["seventh", "add9", "sus2", "firstInversion"],
  // iv: m7, then flipped to a major IV (the dorian lift).
  5: ["seventh", "flip", "add9", "sus2", "sus4"],
  // v: flipped to the major V, and its 7 - the cadence a minor key wants, the harmonic minor's V.
  7: ["flip", "dominantOf", "seventh", "sus4"],
  // VI: maj7 and add9, the lift in every "sad" progression.
  8: ["seventh", "add9", "sus2", "firstInversion"],
  // VII: its dominant 7 and sus4, leading back up to i or across to III.
  10: ["seventh", "sus4", "add9", "firstInversion"],
};

/** Which table each scale borrows: the one whose third it shares. */
const POPULAR_TABLE_FOR: Record<ScaleName, PopularTable> = {
  major: MAJOR,
  lydian: MAJOR,
  mixolydian: MAJOR,
  "major pentatonic": MAJOR,
  minor: MINOR,
  dorian: MINOR,
  phrygian: MINOR,
  "harmonic minor": MINOR,
  "minor pentatonic": MINOR,
  blues: MINOR,
};

/** An order naming every family: `first`, then the rest in the Type order. */
export const completeOrder = (first: readonly ChordFamily[]): ChordFamily[] => [
  ...first,
  ...DEFAULT_CHORD_ORDER.filter((family) => !first.includes(family)),
];

/** The Popular arrangement for a scale: each degree the table names gets its own column order. */
export function popularPrefs(scale: ScaleName): ChordPrefs {
  const table = POPULAR_TABLE_FOR[scale];
  const columns = Object.fromEntries(
    SCALES[scale].flatMap((interval, degree) => {
      const first = table[interval];
      return first ? [[degree, { order: completeOrder(first), hidden: [] }]] : [];
    }),
  );
  return { order: DEFAULT_CHORD_ORDER, hidden: [], columns, favourites: [] };
}
