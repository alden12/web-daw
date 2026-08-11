/**
 * The pads' key, scale and octave range (MOBILE-6).
 *
 * **A local setting, deliberately, and a temporary one.** The pads are the first real
 * consumer of a project-level key and scale; until the project carries one, persisting it
 * per browser is the honest version - it is a view preference here, not a property of the
 * music. When the project gains a key, this hook is where it gets read from instead, and
 * the pads do not change.
 *
 * The octave range is **one control**: a pair of buttons moves it, a pair sizes it, and they
 * share a label. Both pairs work in whole *rows* rather than whole octaves, so on a tablet -
 * which fits two octaves to a row - octaves come and go in pairs and every row stays the
 * same width as its neighbours. A lopsided last row is the one thing that makes the stack
 * stop reading as a keyboard.
 */
import { usePersistentBoolean, usePersistentNumber, usePersistentString } from "../usePersistent";
import { PITCH_CLASSES, SCALE_NAMES, pitchAt, type ScaleName } from "../../audio/theory/scales";
import { pitchName } from "../noteNames";

/**
 * The lowest and highest octave the range may sit in, in the roll's numbering (C4 = 60).
 *
 * Its span is also the pads' hard ceiling: `fitPads` says how many rows there is *room* for,
 * and this says how many there are *notes* for. Between the two there is no arbitrary "most
 * rows worth showing" left to pick.
 */
export const OCTAVE_RANGE = { min: 0, max: 8 };

export interface PadSettings {
  tonic: number;
  scale: ScaleName;
  lowOctave: number;
  /** Octaves on show. Always a whole number of rows. */
  octaves: number;
  accidentals: boolean;
  setTonic: (tonic: number) => void;
  setScale: (scale: ScaleName) => void;
  setAccidentals: (on: boolean) => void;
  /** Move the range, and size it. Each is a no-op at its limit; the flags say which. */
  moveRange: (direction: -1 | 1) => void;
  sizeRange: (direction: -1 | 1) => void;
  canMove: (direction: -1 | 1) => boolean;
  canSize: (direction: -1 | 1) => boolean;
  /** "C major", for the control that opens the key menu. */
  keyLabel: string;
  /** "C3 - C4": the range both pairs of buttons act on, shared between them. */
  rangeLabel: string;
}

export function usePadSettings(octavesPerRow: number, maxRows: number): PadSettings {
  const [tonic, setTonic] = usePersistentNumber("web-daw:pads-tonic", 0, 0, PITCH_CLASSES.length - 1);
  const [scale, setScale] = usePersistentString<ScaleName>("web-daw:pads-scale", "major", SCALE_NAMES);
  const [storedOctave, setLowOctave] = usePersistentNumber(
    "web-daw:pads-octave",
    3,
    OCTAVE_RANGE.min,
    OCTAVE_RANGE.max,
  );
  const [storedOctaves, setOctaves] = usePersistentNumber("web-daw:pads-octaves", 1, 1, OCTAVE_RANGE.max);
  // On by default: the pads still show the whole chromatic octave, they just show it as a
  // shape. Switching them off gives a row you cannot play a wrong note in, which may yet
  // prove the better default on a phone - that is a question for real use, not for now.
  const [accidentals, setAccidentals] = usePersistentBoolean("web-daw:pads-accidentals", true);

  // Both ceilings, in one place: what the room allows (`geometry.ts`) and what the pitch
  // range holds. The stored value is kept as asked for, so throwing the sheet up gives back
  // the rows that did not fit at Half rather than making you ask for them again.
  const maxOctaves = Math.min(maxRows * octavesPerRow, OCTAVE_RANGE.max);
  // Rounded down to whole rows, because `octavesPerRow` changes underneath the stored value
  // when a phone is rotated into the tablet tier: three octaves is one and a half rows there,
  // and half a row is the lopsided thing this control exists to avoid.
  const octaves = Math.min(
    maxOctaves,
    Math.max(octavesPerRow, Math.floor(storedOctaves / octavesPerRow) * octavesPerRow),
  );
  // The top of the range is a hard ceiling (the range grows *downwards* when it has to), so
  // a low octave is only valid if the whole range still fits beneath it.
  const highestLow = OCTAVE_RANGE.max - octaves;
  const lowOctave = Math.min(storedOctave, highestLow);

  const canMove = (direction: -1 | 1) => (direction < 0 ? lowOctave > OCTAVE_RANGE.min : lowOctave < highestLow);
  const canSize = (direction: -1 | 1) =>
    direction < 0 ? octaves > octavesPerRow : octaves + octavesPerRow <= maxOctaves;

  return {
    tonic,
    scale,
    lowOctave,
    octaves,
    accidentals,
    setTonic,
    setScale,
    setAccidentals,
    moveRange: (direction) => {
      if (canMove(direction)) setLowOctave(lowOctave + direction);
    },
    sizeRange: (direction) => {
      if (!canSize(direction)) return;
      const next = octaves + direction * octavesPerRow;
      setOctaves(next);
      // Growing off the top of the range takes the extra from below instead of refusing.
      if (lowOctave + next > OCTAVE_RANGE.max) setLowOctave(OCTAVE_RANGE.max - next);
    },
    canMove,
    canSize,
    keyLabel: `${PITCH_CLASSES[tonic]} ${scale}`,
    rangeLabel: `${pitchName(pitchAt(tonic, lowOctave))} - ${pitchName(pitchAt(tonic, lowOctave + octaves))}`,
  };
}
