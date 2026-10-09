/**
 * Everything the desktop shell needs for the computer keyboard (DAW-12.1): the pads' settings, the
 * layout, the key handling and the panel's height, in one place so the shell stays a layout.
 *
 * **All four rows always play; the range control says how many are drawn.** The panel can shrink
 * to a row in the piano roll without losing a key, and the octave arrows move the whole range.
 */
import { useState } from "react";
import { pitchName } from "../../audio/params/noteName";
import { pitchAt } from "../../audio/theory/scales";
import type { LiveNotes } from "../../audio/live/liveNotes";
import { OCTAVE_RANGE, usePadSettings, type PadSettings } from "../pads/padSettings";
import { PAD_VELOCITY, usePadTouch } from "../pads/usePadTouch";
import { usePersistentBoolean, usePersistentNumber } from "../usePersistent";
import { KEY_ROW_COUNT, keyboardRows, octavesSpanned, padsByCode, type KeyRowMode } from "./keyLayout";
import { useKeyboardPlaying, useShiftHeld } from "./useKeyboardPlaying";
import { keysPanelHeight } from "./panelGeometry";

export function useDesktopKeys(liveNotes: LiveNotes, started: boolean) {
  const [open, setOpen] = usePersistentBoolean("corrente:keys-open", true);
  // Not persisted: a strip you set while playing, not a preference.
  const [velocity, setVelocity] = useState(PAD_VELOCITY);
  const [shownRows, setShownRows] = usePersistentNumber("corrente:keys-rows-shown", KEY_ROW_COUNT, 1, KEY_ROW_COUNT);
  const padSettings = usePadSettings(1, KEY_ROW_COUNT);
  // The pads' own Accidentals switch: on, alternate rows are the accidentals, as the pads show them
  // in a band above each row; off, every row is an octave and Shift reaches the sharps.
  const rowMode: KeyRowMode = padSettings.accidentals ? "accidentals" : "octaves";
  const settings = drawnRowSettings(padSettings, shownRows, setShownRows, octavesSpanned(rowMode));
  const touch = usePadTouch(liveNotes);
  const enabled = started && !settings.editingChords;
  // Shift turns the octave rows into their sharps; accidental rows have them already.
  const raised = useShiftHeld(enabled && !settings.chords && rowMode === "octaves");

  const rows = keyboardRows({
    tonic: settings.tonic,
    scale: settings.scale,
    lowOctave: settings.lowOctave,
    rowMode,
    raised,
    chords: settings.chords,
    prefs: settings.chordPrefs,
    editing: settings.editingChords,
  });
  const keyboard = useKeyboardPlaying({
    pads: padsByCode(rows),
    target: liveNotes,
    enabled,
    onOctave: settings.moveRange,
    velocity: () => velocity,
  });

  return {
    panel: {
      rows,
      settings,
      touch,
      keyboard,
      open,
      onToggle: () => setOpen(!open),
      shownRows,
      rowMode,
      velocity,
      onVelocity: setVelocity,
    },
    height: keysPanelHeight(open, shownRows),
  };
}

/**
 * The pads' settings with the range pinned to every octave the rows span and `+`/`-` sizing the
 * display instead. The low octave is clamped so the whole span fits beneath the top of the range.
 */
function drawnRowSettings(
  settings: PadSettings,
  shown: number,
  setShown: (rows: number) => void,
  spanned: number,
): PadSettings {
  const highestLow = OCTAVE_RANGE.max - spanned;
  const lowOctave = Math.min(settings.lowOctave, highestLow);
  const canMove = (direction: -1 | 1) => (direction < 0 ? lowOctave > OCTAVE_RANGE.min : lowOctave < highestLow);
  const canSize = (direction: -1 | 1) => (direction < 0 ? shown > 1 : shown < KEY_ROW_COUNT);
  const low = pitchName(pitchAt(settings.tonic, lowOctave));
  return {
    ...settings,
    lowOctave,
    canMove,
    moveRange: (direction) => {
      if (canMove(direction)) settings.moveRange(direction);
    },
    canSize,
    sizeRange: (direction) => {
      if (canSize(direction)) setShown(shown + direction);
    },
    rangeLabel: settings.chords ? low : `${low} - ${pitchName(pitchAt(settings.tonic, lowOctave + spanned))}`,
  };
}
