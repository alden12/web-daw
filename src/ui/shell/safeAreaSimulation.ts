/**
 * Pretend the display has insets it does not have (MOBILE-8). **Dev and test only** - this
 * module is imported from the `import.meta.env` branch in `main.tsx` and nothing else, so
 * none of it reaches a production build.
 *
 * `env()` is 0 in every browser that has no inset to report, and a phone browser reports
 * almost none of them: its own chrome is already covering the status bar, so in portrait the
 * top inset is 0 whatever device you are holding. That leaves the padding in `safeArea.ts`
 * nearly impossible to *look* at while building it, which is how it came to be
 * half-implemented in the first place. Installing the app as a PWA (MOBILE-3) will not retire
 * this either - an installed PWA on Android still sits below the system status bar, so the
 * top inset stays 0 there too.
 *
 * So each value in `safeArea.ts` reads a custom property before falling back to the real
 * inset, and this is what writes them.
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
 * What none of this can tell you is whether iOS reports the insets you assumed, so a real
 * device still has the last word. But it turns "did the layout move at all" into something you
 * can answer in a second, which is the question that was going unanswered.
 */
import { SAFE_AREA_EDGES, simulationVariable } from "./safeArea";

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Pretend the display has these insets, in px. `null` hands it back to the real device. */
export function simulateInsets(insets: Insets | null): void {
  const root = document.documentElement;
  SAFE_AREA_EDGES.forEach((edge) => {
    if (insets) root.style.setProperty(simulationVariable(edge), `${insets[edge]}px`);
    else root.style.removeProperty(simulationVariable(edge));
  });
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
 * Read `?insets=` and apply it, remembering the choice.
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
