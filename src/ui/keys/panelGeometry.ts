/** The keys panel's sizes (DAW-12.1): fixed, so its host sizes it without measuring. */
import { KEYS_PER_ROW } from "./keyLayout";

/** A key: one line, so four rows take little more than three pads' height. */
export const KEY_HEIGHT = 30;
/** A row's width in keys: ten, and the half key the note rows are set across by when there are
 *  accidental rows between them - none otherwise, or it is an empty strip down the right. */
export const rowUnits = (offsetRows: boolean) => KEYS_PER_ROW + (offsetRows ? 0.5 : 0);
export const KEY_GAP = 4;
export const BODY_PADDING = 8;
export const KEYS_HEADER_HEIGHT = 36;

export const keysPanelHeight = (open: boolean, shownRows: number): number =>
  KEYS_HEADER_HEIGHT + (open ? shownRows * KEY_HEIGHT + (shownRows - 1) * KEY_GAP + 2 * BODY_PADDING : 0);
