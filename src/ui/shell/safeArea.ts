/**
 * The display's safe-area insets (MOBILE-8).
 *
 * `index.html` sets `viewport-fit=cover`, so the app reaches under the notch, the corner radii
 * and the home indicator, and has to pad itself back. We had opted into going edge-to-edge and
 * then handled exactly one of the four edges, so the top bar's buttons sat under the corner
 * radius and in landscape the notch took a column off the arrangement.
 *
 * **Keeping `cover` is the decision**, rather than dropping it and letting iOS letterbox the
 * viewport for us: landscape is where this app is most starved of width, and the letterboxed
 * alternative gives that width away permanently, on every device, notch or not.
 *
 * ## The trap
 *
 * **Padding a container does not inset its absolutely positioned children.** An abspos box's
 * containing block is its nearest positioned ancestor's *padding box*, which includes the
 * padding area - so `left: 0` lands on the inside of the border, and the padding might as well
 * not be there. Both sheets are abspos, so they each carry their own insets; the workspace
 * padding beside them is for the arrangement, which is an ordinary flex child.
 *
 * This is the thing that looks right in review and does nothing.
 *
 * ## Why `max()` rather than adding
 *
 * The layout already wanted padding of its own. Adding the inset to it doubles the gap on a
 * notched device and looks like a mistake; `max()` takes whichever is larger, so a device with
 * no inset is unchanged and one with an inset gets exactly enough.
 */

export const SAFE_TOP = "env(safe-area-inset-top)";
export const SAFE_BOTTOM = "env(safe-area-inset-bottom)";
export const SAFE_LEFT = "env(safe-area-inset-left)";
export const SAFE_RIGHT = "env(safe-area-inset-right)";

/** The inset, or the padding the layout already wanted - whichever is bigger. */
export const atLeast = (base: string, inset: string) => `max(${base}, ${inset})`;
