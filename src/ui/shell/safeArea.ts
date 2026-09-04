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
 * So each value reads a variable first and falls back to the real inset. Nothing sets those
 * variables in normal use, so the fallback is what ships.
 *
 * **Driven by the URL**, because the device you want to look at this on is a phone and a phone
 * has no console worth using: `chrome://inspect` needs a cable and a laptop, and Safari needs
 * the Web Inspector turned on. A query string needs a typed URL.
 *
 *     ?insets=notch              // a notched phone held upright
 *     ?insets=notch-landscape    // ...turned sideways, which is where the notch costs most
 *     ?insets=59,34,12,21        // top,bottom,left,right in px
 *     ?insets=off                // back to the real device
 *
 * The choice sticks until it is turned off, so following a link or reloading does not silently
 * drop you back to a device with no notch and make the padding look broken.
 *
 * `simulateInsets` is the same thing from a console, and is on `window` in dev and test.
 *
 * What none of this can tell you is whether iOS reports the insets you assumed, so a device
 * still has the last word - but it turns "did the layout move at all" into something you can
 * answer in a second, which is the question that was going unanswered.
 */

/** Reads an override first, so the layout can be exercised where there is no real inset. */
const inset = (edge: "top" | "bottom" | "left" | "right") => `var(--sim-safe-${edge}, env(safe-area-inset-${edge}))`;

export const SAFE_TOP = inset("top");
export const SAFE_BOTTOM = inset("bottom");
export const SAFE_LEFT = inset("left");
export const SAFE_RIGHT = inset("right");

/** Pretend the display has these insets, in px. `null` hands it back to the real device. */
export function simulateInsets(insets: Insets | null): void {
  const root = document.documentElement;
  for (const edge of ["top", "bottom", "left", "right"] as const) {
    if (insets) root.style.setProperty(`--sim-safe-${edge}`, `${insets[edge]}px`);
    else root.style.removeProperty(`--sim-safe-${edge}`);
  }
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The shapes worth having a name for. Numbers are an iPhone 14 Pro, which is the harshest
 * common case: the tallest status bar and, sideways, a notch on one edge and a home indicator
 * on the other.
 */
const PRESETS: Record<string, Insets> = {
  notch: { top: 59, bottom: 34, left: 0, right: 0 },
  "notch-landscape": { top: 0, bottom: 21, left: 59, right: 59 },
};

const STORAGE_KEY = "web-daw:sim-insets";

/** `notch`, `notch-landscape`, `off`, or `top,bottom,left,right` in px. */
function parseInsets(value: string): Insets | null {
  if (value in PRESETS) return PRESETS[value];
  const numbers = value.split(",").map(Number);
  if (numbers.length !== 4 || numbers.some((number) => !Number.isFinite(number))) return null;
  const [top, bottom, left, right] = numbers;
  return { top, bottom, left, right };
}

/**
 * Read `?insets=` and apply it, remembering the choice. Called from `main.tsx` in dev and test
 * only, so nothing here reaches a production build.
 *
 * Stored rather than read fresh each time, because the query string is gone the moment the app
 * rewrites the URL to the open project - so without this, simulating a notch would last until
 * the first navigation and then quietly stop, which looks exactly like the padding failing.
 */
export function applySimulatedInsets(): void {
  const requested = new URLSearchParams(window.location.search).get("insets");
  try {
    if (requested === "off") localStorage.removeItem(STORAGE_KEY);
    else if (requested) {
      const insets = parseInsets(requested);
      if (insets) localStorage.setItem(STORAGE_KEY, JSON.stringify(insets));
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    simulateInsets(stored ? (JSON.parse(stored) as Insets) : null);
  } catch {
    // Private mode, or a malformed stored value. The real insets are the right fallback.
  }
}

/** The inset, or the padding the layout already wanted - whichever is bigger. */
export const atLeast = (base: string, inset: string) => `max(${base}, ${inset})`;
