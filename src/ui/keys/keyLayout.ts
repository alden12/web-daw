/**
 * The computer keyboard as a playing surface (DAW-12.1): the same key, scale and chords the
 * pads play (MOBILE-6, MOBILE-12), laid over the four rows of letter and number keys.
 *
 * **Keys are physical positions, not characters.** Everything is keyed by `KeyboardEvent.code`
 * (`KeyZ`, `Digit1`), so Shift does not turn `1` into `!`, and an AZERTY or Dvorak board plays
 * the same shape - the panel asks the browser what each key prints (`useKeycapLabels`).
 *
 * **A row is an octave, and a column is a degree.** Each row starts on the tonic and runs up the
 * scale for its ten keys, so the closing tonic lands on the eighth key and the last two reach into
 * the next octave, which the row above starts on. The same fingering plays the same thing on
 * every row.
 *
 * **Two ways to reach the accidentals** (the notes outside the scale):
 * - **Alternate rows are the accidentals** (`rowMode: "accidentals"`): two octaves on four rows,
 *   each note's sharp on the key up and to its right - in C major with C on Z, C# on S and D# on D,
 *   F# G# A# on G H J, and nothing over E and B. The tracker layout, and a piano's black keys: the
 *   note rows are drawn half a key to the right (`isAccidentalRow`), so each accidental sits between
 *   the two notes it is between.
 * - **Shift** (`raised`) turns every key of an octave row, while held, into **its own note's sharp**,
 *   where that is outside the scale, and blanks the rest (E and B in C major): the panel shows
 *   exactly which keys have one. Tried and dropped (2026-10-09): falling back to the flat so no key
 *   is dead, with the two keys either side of a black key merged into one pad - it read as two keys
 *   playing one note, where a gap says plainly that there is nothing there.
 *
 * In chords mode the bottom row is each degree's triad and the rows above are its variations,
 * exactly as the chord pads stack them. Past the closing tonic, the keys left in a row carry on into
 * the octave above (Dm and Em on the last two keys in C major), as the note rows do.
 *
 * Pure and DOM-free; the panel draws it and `useKeyboardPlaying` plays it.
 */
import { SCALES, intervalLabel, pitchAt, type ScaleName } from "../../audio/theory/scales";
import { chordRows, type ChordFamily, type ChordPrefs } from "../../audio/theory/chords";
import { pitchName } from "../../audio/params/noteName";

/** The playing rows, **bottom row first**, by `KeyboardEvent.code`. */
export const KEY_ROWS = [
  ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon"],
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"],
  ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"],
] as const;

/** The most rows the keyboard has to give: an octave each, or the triads and three variations. */
export const KEY_ROW_COUNT = KEY_ROWS.length;

/** Keys in a row. */
export const KEYS_PER_ROW = KEY_ROWS[0].length;

/** The keys beside the playing rows that move the range, by code: an octave down or up. */
export const OCTAVE_KEYS: Record<string, -1 | 1> = { BracketLeft: -1, BracketRight: 1 };

const PUNCTUATION: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";" };

/** What a key prints on a US QWERTY board: the fallback where the browser cannot say. */
export const qwertyLabel = (code: string): string =>
  PUNCTUATION[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "");

export type KeyTone = "tonic" | "in-scale" | "accidental" | "favourite";

export interface KeyPad {
  /** What it plays: one note, or a chord's. */
  pitches: number[];
  /** For the accessibility tree: a note name, or a chord's. */
  name: string;
  label: string;
  sublabel: string;
  tone: KeyTone;
  /** A chord's identity, for the chord editor to select it by. */
  chord?: { degree: number; family: ChordFamily | "triad"; hidden: boolean };
}

export interface KeyCell {
  code: string;
  /** Null for a key that plays nothing in this layout. */
  pad: KeyPad | null;
}

/** What alternate rows are: the next octave up, or the accidentals of the row beneath. */
export type KeyRowMode = "octaves" | "accidentals";

/** How many octaves the four rows span in a row mode. */
export const octavesSpanned = (rowMode: KeyRowMode) => (rowMode === "accidentals" ? KEY_ROW_COUNT / 2 : KEY_ROW_COUNT);

export interface KeyboardLayoutOptions {
  tonic: number;
  scale: ScaleName;
  /** Octave of the bottom row's tonic, in the roll's numbering (C4 = 60). */
  lowOctave: number;
  rowMode: KeyRowMode;
  /** Shift is held: each key of an octave row plays the black key beside its note. */
  raised: boolean;
  chords: boolean;
  prefs: ChordPrefs;
  /** Lay out hidden chords too, for the chord editor. */
  editing: boolean;
}

/** The keyboard's layout for a key and range, **bottom row first**, a cell per key. */
export function keyboardRows(options: KeyboardLayoutOptions): KeyCell[][] {
  return options.chords ? chordKeys(options) : noteKeys(options);
}

/** Whether a row is an accidental row of `rowMode: "accidentals"`: the note rows sit half a key right of these. */
export const isAccidentalRow = (
  rowIndex: number,
  { chords, rowMode }: Pick<KeyboardLayoutOptions, "chords" | "rowMode">,
): boolean => !chords && rowMode === "accidentals" && rowIndex % 2 === 1;

function noteKeys(options: KeyboardLayoutOptions): KeyCell[][] {
  const { tonic, scale, lowOctave, rowMode, raised } = options;
  const intervals: readonly number[] = SCALES[scale];
  const inScale = (semitones: number) => intervals.includes(((semitones % 12) + 12) % 12);
  /** A column's note, in semitones above the row's tonic. */
  const degreeAt = (column: number) =>
    intervals[column % intervals.length] + 12 * Math.floor(column / intervals.length);
  const pad = (octave: number, semitones: number): KeyPad => {
    const pitch = pitchAt(tonic, lowOctave + octave) + semitones;
    return {
      pitches: [pitch],
      name: pitchName(pitch),
      label: intervalLabel(semitones),
      sublabel: pitchName(pitch),
      tone: !inScale(semitones) ? "accidental" : semitones % 12 === 0 ? "tonic" : "in-scale",
    };
  };
  /** A note's sharp, where it is outside the scale. */
  const sharpOf = (octave: number, note: number): KeyPad | null => (inScale(note + 1) ? null : pad(octave, note + 1));
  return KEY_ROWS.map((codes, rowIndex) =>
    codes.map((code, column) => {
      const octave = rowMode === "accidentals" ? Math.floor(rowIndex / 2) : rowIndex;
      if (rowMode === "octaves")
        return { code, pad: raised ? sharpOf(octave, degreeAt(column)) : pad(octave, degreeAt(column)) };
      if (!isAccidentalRow(rowIndex, options)) return { code, pad: pad(octave, degreeAt(column)) };
      // The key up and to the right of a note plays its sharp, so the first key has none.
      if (column === 0) return { code, pad: null };
      return { code, pad: sharpOf(octave, degreeAt(column - 1)) };
    }),
  );
}

/**
 * While the chords are being arranged, the rows past the keyboard's four - every family the key
 * offers, hidden ones too - so they can be selected and moved down onto the keys. They have no key,
 * so their cells take a code no key event carries.
 */
const arrangeCodes = (rowIndex: number): readonly string[] =>
  Array.from({ length: KEYS_PER_ROW }, (_unused, column) => `arrange-${rowIndex}-${column}`);

/** Whether a cell is one of the arranging rows' rather than a real key. */
export const isArrangeCode = (code: string) => code.startsWith("arrange-");

function chordKeys({ tonic, scale, lowOctave, prefs, editing }: KeyboardLayoutOptions): KeyCell[][] {
  const grid = (octave: number, rows?: number) =>
    chordRows({ tonic, scale, lowOctave: lowOctave + octave, prefs, editing, rows });
  // Every row the key fills while arranging, the keyboard's four otherwise; the same for each octave.
  const depth = editing ? Math.max(KEY_ROW_COUNT, grid(0).length) : KEY_ROW_COUNT;
  // A grid per octave the row reaches: each starts on the tonic, so a column past the scale's last
  // degree is that column of the octave above (and the closing tonic is the next octave's first).
  const degrees = SCALES[scale].length;
  const grids = Array.from({ length: Math.ceil(KEYS_PER_ROW / degrees) }, (_unused, octave) => grid(octave, depth));
  const codesFor = (rowIndex: number) => KEY_ROWS[rowIndex] ?? arrangeCodes(rowIndex);
  return Array.from({ length: depth }, (_unused, rowIndex) =>
    codesFor(rowIndex).map((code, column) => {
      const chord = grids[Math.floor(column / degrees)][rowIndex]?.[column % degrees];
      if (!chord) return { code, pad: null };
      return {
        code,
        pad: {
          pitches: chord.pitches,
          name: chord.name,
          label: chord.name,
          sublabel: chord.favourite ? `★ ${chord.caption}` : chord.caption,
          // As the chord pads tone them, so the two surfaces read the same.
          tone: chord.favourite
            ? "favourite"
            : chord.outside
              ? "accidental"
              : rowIndex === 0 && chord.degree === 0
                ? "tonic"
                : "in-scale",
          chord: { degree: chord.degree, family: chord.family, hidden: chord.hidden },
        },
      };
    }),
  );
}

/** Each playing key's pad, by code: what a key press looks up. */
export const padsByCode = (rows: KeyCell[][]): Map<string, KeyPad> =>
  new Map(rows.flat().flatMap(({ code, pad }) => (pad ? [[code, pad] as const] : [])));
