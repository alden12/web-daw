/**
 * The app's mark, on the start and sign-in dialogs.
 *
 * Deliberately NOT built from `--color-you` / `--color-claude`, which it used to be. Those
 * two are live UI state twice over: the user can recolour them in Authors, and light mode
 * re-lights them for a white ground. Either one silently repaints the logo, and a mark that
 * changes with a preference or a theme is not a mark.
 *
 * The hexes are the same teal and coral the voices *default* to, so the mark still looks like
 * the app it opens. It just no longer follows them when they move.
 */
const BRAND_TEAL = "#56c7c2";
const BRAND_CORAL = "#d9775a";

export const BRAND_MARK = `conic-gradient(from 200deg, ${BRAND_TEAL}, ${BRAND_CORAL}, ${BRAND_TEAL})`;
