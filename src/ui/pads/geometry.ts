/**
 * How much room the pads need, and how much of it they may have (MOBILE-6).
 *
 * **The octave count is a function of the space, not a constant.** A phone in landscape
 * leaves the sheet under 200px and can only really hold one row; a tablet in portrait can
 * hold four. Picking a number for "the mobile limit" would be wrong at both ends, so the
 * limit is computed from the room the editor actually has at the committed detent - and
 * from a *share* of it, so the surface the pads sit under grows with the sheet too
 * (`PADS_SHARE`).
 *
 * Pure, so the fitting is unit-testable without a browser: the numbers below are the pad
 * layout's own, and `fitPads` is the only place they are turned into a decision.
 */

/** An in-scale pad. Comfortably over the 44px hit-target floor (MOBILE-2). */
export const PAD_HEIGHT = 52;
/**
 * An accidental, sitting above the row as a black key does: the note you reach *for*.
 *
 * Shorter than a natural, and that is now the only thing that distinguishes them. They used
 * to be narrower as well, which made them fiddly for the thing they are - a note you jab at
 * in passing - so they went to a full pad width and height took over the job of saying
 * "these are the ones off to the side". Still clear of the 44px floor with the gap included.
 */
export const ACCIDENTAL_HEIGHT = 30;
/**
 * Between stacked rows, and it depends on whether the accidentals are showing.
 *
 * With them on, the band already separates one row of naturals from the next, so 4px is
 * spacing. With them off the rows abut, and 4px is not a boundary a finger respects: a touch
 * near the seam lands on both rows and the octaves either side of it sound together. The gap
 * is doing hit-testing work there, not decoration, so it grows to something a fingertip
 * cannot straddle.
 *
 * `padRowHeight` reads the same function the layout does, so a row's measured height and its
 * drawn height cannot drift - that would either clip the last row or leave a dead strip.
 */
export const ROW_GAP = 4;
export const BARE_ROW_GAP = 12;
export const rowGap = (accidentals: boolean) => (accidentals ? ROW_GAP : BARE_ROW_GAP);
/**
 * Between pads, in both axes. The pads are separated by space rather than by borders, so this
 * is what makes them read as individual keys; it is also subtracted from an accidental's
 * width, since those are positioned rather than laid out and get no gap for free.
 */
export const PAD_GAP = 4;
/** The key/scale menu and the octave range, when they get a row of their own. */
export const CONTROLS_HEIGHT = 38;
/** `EditorSection`'s disclosure row (`h-9`). */
export const SECTION_HEADER = 36;
/** The padding under the pads, so the last row is not flush against the sheet's edge. */
export const PADS_PADDING = 8;

/**
 * What the surface above cannot give up, taken from the editor because it is the surface the
 * pads crowd hardest: `InstrumentEditor`'s padding and its clip-name row. The roll itself can
 * go to nothing, but this is there whether it does or not.
 */
export const EDITOR_CHROME = 52;

/**
 * How the pads and the surface above them divide the sheet: the pads may take this share of
 * it, and whatever they are under keeps the rest.
 *
 * **A share rather than a fixed reserve, and that is the whole of it.** Keeping a flat 40px
 * for the roll meant the pads absorbed everything a taller sheet gave you: throwing it from
 * Half to Full grew the pads and left the roll the same unreadable sliver, so the sheet's
 * range bought pads and nothing else. Dividing the room makes both grow together, and
 * dropping back to Half gives rows back before it gives back notes. You raise the sheet to
 * see more of what you are editing; more pads is what comes with it.
 *
 * It bounds the *limit*, not the default - what is on show is the stored octave count, which
 * starts at one - so it decides where `+` stops.
 */
export const PADS_SHARE = 0.65;

export interface PadFit {
  /**
   * Rows of pads that fit. **Zero is a real answer** - a landscape phone at Half has under
   * 140px of editor, which is not one row plus the controls to drive it however the numbers
   * are shuffled. The section then says so, rather than showing half a pad.
   *
   * There is no constant ceiling: the room says how many rows there is space for and the
   * pitch range (`OCTAVE_RANGE`, applied in `padSettings`) says how many there are notes
   * for, and between them nothing arbitrary is left to pick.
   */
  rows: number;
  /**
   * Whether the key/scale and octave controls have to share the section's header row. True
   * where a row of their own would cost the last row of pads - which is landscape on a
   * phone, and landscape is short *and* wide, so the header has the width to take them.
   */
  inlineControls: boolean;
}

/**
 * What the fitting will give up, in the order it is willing to give it up, to fit a row at
 * all. The first arrangement that fits one wins.
 *
 * The controls' own row goes first: folded into the section header they cost a little width,
 * where the roll's share costs the thing you are playing along to. Handing that share over
 * is the last resort, and it buys a single row - it is there so a landscape phone can be
 * played at all, not so any short editor fills itself with pads.
 */
const ARRANGEMENTS: readonly { inlineControls: boolean; padsShare: number; limit: number }[] = [
  { inlineControls: false, padsShare: PADS_SHARE, limit: Infinity },
  { inlineControls: true, padsShare: PADS_SHARE, limit: Infinity },
  { inlineControls: true, padsShare: 1, limit: 1 },
];

/** How tall one row of pads is, accidentals included when they are on. */
export const padRowHeight = (accidentals: boolean) =>
  PAD_HEIGHT + (accidentals ? ACCIDENTAL_HEIGHT : 0) + rowGap(accidentals);

/**
 * What fits in `room` pixels of editor - the sheet's content box at the committed detent.
 *
 * `EDITOR_CHROME` comes off the top because it belongs to neither surface; what is left is
 * what the pads and the roll divide, and every arrangement divides the same number.
 */
export function fitPads(room: number, accidentals: boolean): PadFit {
  const rowHeight = padRowHeight(accidentals);
  const editor = Math.max(0, room - EDITOR_CHROME);
  const fits = ARRANGEMENTS.map(({ inlineControls, padsShare, limit }) => {
    const chrome = SECTION_HEADER + PADS_PADDING + (inlineControls ? 0 : CONTROLS_HEIGHT);
    return {
      rows: Math.max(0, Math.min(limit, Math.floor((editor * padsShare - chrome) / rowHeight))),
      inlineControls,
    };
  });
  // Nothing fits anywhere: the last arrangement is the one that gave up the most, so its
  // zero is the honest answer and its `inlineControls` the one the empty section renders.
  return fits.find((fit) => fit.rows >= 1) ?? fits[fits.length - 1];
}
