/**
 * Scales, and the pad layout derived from one (MOBILE-6). Pure and DOM-free, so the
 * agent tools can reach for the same key/scale vocabulary the pads use.
 *
 * The layout **generalises the piano rather than imitating it**: in-scale notes take a
 * full-width row and everything else sits above, in the gaps between them. Because the
 * gaps come from the scale's own interval pattern, the shape holds for any key or mode
 * with only the labels moving - and in C major it lands the accidentals exactly where a
 * piano's black keys are, which is the point.
 *
 * **Each row closes on the next tonic**, exactly as a piano octave ends on C. Without it
 * the leading tone has no gap above it to sit in and disappears from the row entirely -
 * found by laying the thing out across six scales, not by looking at one.
 */

/** Semitone offsets from the tonic. A scale is nothing more than this. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "major pentatonic": [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
} as const satisfies Record<string, readonly number[]>;

export type ScaleName = keyof typeof SCALES;
export const SCALE_NAMES = Object.keys(SCALES) as ScaleName[];

/** Pitch classes, sharp-spelled to match `pitchName` (the roll's own spelling). */
export const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const INTERVAL_LABELS = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

/**
 * A semitone distance as the interval you would name it (`1`, `b3`, `5`). This is what
 * you think in once a key is set, and it is what each pad is labelled with - the note
 * name is the subtitle, not the heading.
 */
export const intervalLabel = (semitones: number): string => INTERVAL_LABELS[((semitones % 12) + 12) % 12];

/** The MIDI pitch of a pitch class in an octave, in the roll's numbering (C4 = 60). */
export const pitchAt = (pitchClass: number, octave: number): number => (octave + 1) * 12 + pitchClass;

export interface Pad {
  pitch: number;
  /** Its interval from the tonic - `1`, `b3`, `5`. */
  interval: string;
}

export interface AccidentalPad extends Pad {
  /**
   * Where it sits along the row, measured in in-scale pad widths from the left edge.
   * A whole number is the seam between two pads; two accidentals sharing one gap
   * straddle it. The row's own width is `pitches.length` in these units, so a renderer
   * turns this into a percentage without knowing anything about pixels.
   */
  center: number;
}

export interface PadRow {
  /** The in-scale pads, low to high, closing on the next tonic. */
  pitches: Pad[];
  /** Everything else, positioned in the gaps. Empty when accidentals are switched off. */
  accidentals: AccidentalPad[];
}

/** How wide an accidental is, in in-scale pad widths. Keeps two-in-a-gap clear of each other. */
const ACCIDENTAL_WIDTH = 0.62;

export interface PadLayoutOptions {
  /** Tonic pitch class, 0..11. */
  tonic: number;
  scale: ScaleName;
  /** Octave of the lowest row's tonic, in the roll's numbering (C4 = 60). */
  lowOctave: number;
  /** Total octaves on show. */
  octaves: number;
  /** A tablet fits two per row, a phone one - below ~44px per pad the layout is wrong. */
  octavesPerRow: number;
  /** Off gives a row you cannot play a wrong note in. On a phone that may be the better default. */
  accidentals: boolean;
}

/**
 * The rows of pads for a key and range, **low to high** - a renderer showing more than
 * one stacks them the other way up, as the roll does.
 */
export function padRows({ tonic, scale, lowOctave, octaves, octavesPerRow, accidentals }: PadLayoutOptions): PadRow[] {
  const intervals = SCALES[scale];
  const rowCount = Math.ceil(octaves / octavesPerRow);

  return Array.from({ length: rowCount }, (_unused, rowIndex) => {
    const rowOctaves = Math.min(octavesPerRow, octaves - rowIndex * octavesPerRow);
    const root = pitchAt(tonic, lowOctave + rowIndex * octavesPerRow);
    const octaveIndices = Array.from({ length: rowOctaves }, (_octave, index) => index);

    const pitches: Pad[] = [
      ...octaveIndices.flatMap((octave) =>
        intervals.map((semitones) => ({
          pitch: root + octave * 12 + semitones,
          interval: intervalLabel(semitones),
        })),
      ),
      // The closing tonic: the reason the last in-scale note of the row has a gap above it.
      { pitch: root + rowOctaves * 12, interval: intervalLabel(0) },
    ];

    return { pitches, accidentals: accidentals ? accidentalsFor(intervals, root, octaveIndices) : [] };
  });
}

/**
 * The out-of-scale notes, each centred on the seam between the two in-scale pads it falls
 * between. Where a gap is wide enough to hold more than one (a pentatonic's minor third,
 * say) they share the seam, spread evenly around it, rather than stacking on top of
 * each other.
 */
function accidentalsFor(intervals: readonly number[], root: number, octaveIndices: number[]): AccidentalPad[] {
  const outOfScale = Array.from({ length: 12 }, (_unused, semitones) => semitones).filter(
    (semitones) => !intervals.includes(semitones),
  );

  return octaveIndices.flatMap((octave) => {
    const seamOf = (semitones: number) =>
      octave * intervals.length + intervals.filter((interval) => interval < semitones).length;
    // Group by seam first, so each accidental knows how many others share its gap.
    return outOfScale.flatMap((semitones) => {
      const sharing = outOfScale.filter((other) => seamOf(other) === seamOf(semitones));
      const positionInGap = sharing.indexOf(semitones);
      return {
        pitch: root + octave * 12 + semitones,
        interval: intervalLabel(semitones),
        center: seamOf(semitones) + (positionInGap - (sharing.length - 1) / 2) * ACCIDENTAL_WIDTH,
      };
    });
  });
}

/** The width of an accidental, in the same in-scale-pad-width units as `center`. */
export const accidentalWidth = ACCIDENTAL_WIDTH;
