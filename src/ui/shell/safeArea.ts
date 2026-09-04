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
 *
 * ## Trying it without a notch
 *
 * `env()` is 0 in every browser that has no inset to report, and a phone browser reports
 * almost none of them - its own chrome is already covering the status bar, so in portrait the
 * top inset is 0 whatever device you are on. That leaves this nearly impossible to *look* at
 * during development, which is how it came to be half-implemented in the first place.
 *
 * So each value reads a variable first and falls back to the real inset, and `simulateInsets`
 * sets those variables. Nothing sets them in normal use, so the fallback is what ships; they
 * exist so the layout can be seen reacting on a laptop.
 *
 *     import { simulateInsets } from "./ui/shell/safeArea";
 *     simulateInsets({ top: 59, bottom: 34, left: 0, right: 0 });  // iPhone, portrait
 *     simulateInsets({ top: 0, bottom: 21, left: 59, right: 59 }); // ...and landscape
 *     simulateInsets(null);                                        // back to the real ones
 *
 * What this cannot tell you is whether iOS reports the insets you assumed, so a device still
 * has the last word - but it turns "did the layout move at all" into something you can answer
 * in a second, which is the question that was going unanswered.
 */

/** Reads an override first, so the layout can be exercised where there is no real inset. */
const inset = (edge: "top" | "bottom" | "left" | "right") => `var(--sim-safe-${edge}, env(safe-area-inset-${edge}))`;

export const SAFE_TOP = inset("top");
export const SAFE_BOTTOM = inset("bottom");
export const SAFE_LEFT = inset("left");
export const SAFE_RIGHT = inset("right");

/** Pretend the display has these insets, in px. `null` hands it back to the real device. */
export function simulateInsets(insets: { top: number; bottom: number; left: number; right: number } | null): void {
  const root = document.documentElement;
  for (const edge of ["top", "bottom", "left", "right"] as const) {
    if (insets) root.style.setProperty(`--sim-safe-${edge}`, `${insets[edge]}px`);
    else root.style.removeProperty(`--sim-safe-${edge}`);
  }
}

/** The inset, or the padding the layout already wanted - whichever is bigger. */
export const atLeast = (base: string, inset: string) => `max(${base}, ${inset})`;
