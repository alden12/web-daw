/**
 * How much room the pads need, and how much of it they may have (MOBILE-6).
 *
 * **The octave count is a function of the space, not a constant.** A phone in landscape
 * leaves the sheet under 200px and can only really hold one row; a tablet in portrait can
 * hold four. Picking a number for "the mobile limit" would be wrong at both ends, so the
 * limit is computed from the room the editor actually has at the committed detent.
 *
 * Pure, so the fitting is unit-testable without a browser: the numbers below are the pad
 * layout's own, and `fitPads` is the only place they are turned into a decision.
 */

/** An in-scale pad. Comfortably over the 44px hit-target floor (MOBILE-2). */
export const PAD_HEIGHT = 52;
/** An accidental, sitting above the row as a black key does: the note you reach *for*. */
export const ACCIDENTAL_HEIGHT = 34;
/** Between stacked rows. */
export const ROW_GAP = 4;
/** The key/scale menu and the octave range, when they get a row of their own. */
export const CONTROLS_HEIGHT = 38;
/** `EditorSection`'s disclosure row (`h-9`). */
export const SECTION_HEADER = 36;
/** The padding under the pads, so the last row is not flush against the sheet's edge. */
export const PADS_PADDING = 8;

/**
 * What the editor above cannot give up: `InstrumentEditor`'s padding and its clip-name row.
 * The roll itself can go to nothing, but this is there whether it does or not.
 */
export const EDITOR_CHROME = 52;

/**
 * A few rows of notes kept for the roll before the pads may claim the rest. Only a reserve
 * for the *limit* - what is actually on show is the stored octave count, which starts at one
 * - so it decides when `+` stops, not how much room the pads take by default.
 */
export const ROLL_RESERVE = 40;

/** The most rows worth showing: four, which is four octaves on a phone and eight on a tablet. */
export const MAX_PAD_ROWS = 4;

export interface PadFit {
  /**
   * Rows of pads that fit. **Zero is a real answer** - a landscape phone at Half has under
   * 140px of editor, which is not one row plus the controls to drive it however the numbers
   * are shuffled. The section then says so, rather than showing half a pad.
   */
  rows: number;
  /**
   * Whether the key/scale and octave controls have to share the section's header row. True
   * where a row of their own would cost the last row of pads - which is landscape on a
   * phone, and landscape is short *and* wide, so the header has the width to take them.
   */
  inlineControls: boolean;
}

/** How tall one row of pads is, accidentals included when they are on. */
export const padRowHeight = (accidentals: boolean) => PAD_HEIGHT + (accidentals ? ACCIDENTAL_HEIGHT : 0) + ROW_GAP;

/**
 * What fits in `room` pixels of editor - the sheet's content box at the committed detent.
 *
 * Two passes, in preference order: controls in a row of their own with the roll's reserve
 * intact, then controls folded into the header with the reserve given up. The second pass is
 * how landscape gets a playable row at all, and it is only ever reached where the first
 * cannot fit a single one.
 */
export function fitPads(room: number, accidentals: boolean): PadFit {
  const rowHeight = padRowHeight(accidentals);
  const rowsWithin = (chrome: number, reserve: number) =>
    Math.floor((room - EDITOR_CHROME - reserve - chrome) / rowHeight);

  const stacked = rowsWithin(SECTION_HEADER + CONTROLS_HEIGHT + PADS_PADDING, ROLL_RESERVE);
  if (stacked >= 1) return { rows: Math.min(stacked, MAX_PAD_ROWS), inlineControls: false };
  return {
    rows: Math.max(0, Math.min(rowsWithin(SECTION_HEADER + PADS_PADDING, 0), MAX_PAD_ROWS)),
    inlineControls: true,
  };
}
