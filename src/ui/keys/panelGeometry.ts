/** The keys panel's sizes (DAW-12.1): fixed, so its host sizes it without measuring. */

/** A key: one line, so four rows take little more than three pads' height. */
export const KEY_HEIGHT = 30;
/** The widest key, so a very wide window does not stretch them past reading. */
export const KEY_MAX_WIDTH = 120;
/** A row's width in keys: ten, and the half key an accidental row is set across by. */
export const ROW_UNITS = 10.5;
export const KEY_GAP = 4;
export const BODY_PADDING = 8;
export const KEYS_HEADER_HEIGHT = 36;

export const keysPanelHeight = (open: boolean, shownRows: number): number =>
  KEYS_HEADER_HEIGHT + (open ? shownRows * KEY_HEIGHT + (shownRows - 1) * KEY_GAP + 2 * BODY_PADDING : 0);
