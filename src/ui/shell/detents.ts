/**
 * The editor sheet's detent model (MOBILE-5) - pure geometry, no DOM.
 *
 * A detent is expressed as **the fraction of the workspace the sheet covers**, so the
 * gesture maths is one unit whatever the screen: 0 is fully out of the way, 1 covers
 * everything. (Peek is set in pixels and converted - see `detentsFor`.) Keeping it a fraction rather
 * than a pixel offset is the same choice `gridView.ts` makes by storing the arrangement
 * offset in beats - the unit is the one the invariant is expressed in, so the maths falls
 * out instead of needing bookkeeping.
 *
 * This file is deliberately DOM-free so the throw maths is unit-testable; the browser
 * half lives in `useSheetDrag.ts`.
 */
import type { DeviceShape } from "./useDeviceShape";

/**
 * Minimised to its preview bar, editing alongside the arrangement, or covering it (MOBILE-19.1).
 * The names predate that revision: `peek` is the minimised bar.
 */
export type Detent = "peek" | "half" | "full";

/** Ascending by coverage, which is what lets a keyboard step through them. */
export const DETENT_ORDER: readonly Detent[] = ["peek", "half", "full"];

export type DetentSet = Record<Detent, number>;

/**
 * How far ahead of the release the throw is extrapolated before snapping, in ms.
 *
 * This single number *is* the feel of a throw: at 0 the sheet only ever snaps to whichever
 * detent it was nearest when you let go, so flicking stops working and every gesture
 * becomes a drag. Tuned on a device against the prototype.
 */
export const PROJECTION_MS = 130;

/**
 * Half is the one detent that is a share of the screen. A landscape phone (`short`) is the
 * awkward shape - wide but ~390px tall - so its half covers a little more, or the roll is a
 * sliver. Whether half survives there at all is MOBILE-5's open question.
 */
const HALF = { phone: 0.55, short: 0.58, tablet: 0.5 } as const;

/**
 * The other two are **ends, not shares** (MOBILE-19.1). Peek and full used to be fractions too
 * (0.14 and 0.82 on a phone), and both were fiddly in use: peek left a thin strip hard to catch,
 * and full stopped short of the top to keep the selected lane showing, so it was neither out of
 * the way nor a proper full-screen editor. Now:
 *
 * - **peek** is exactly the sheet's header - the preview bar with its expand button - so it
 *   is sized in pixels (`peekPixels`) and becomes a fraction only against the workspace it is
 *   in. Before the workspace has been measured it falls back to a plausible share, so the
 *   first frame is not a sheet with no height.
 * - **full** covers the whole workspace; its header has the minimise button.
 */
const PEEK_FALLBACK = 0.1;

export function detentsFor(
  shape: DeviceShape,
  { workspaceHeight, peekPixels }: { workspaceHeight: number; peekPixels: number },
): DetentSet {
  const half = shape.short ? HALF.short : shape.tier === "tablet" ? HALF.tablet : HALF.phone;
  // Capped below half, so a tiny workspace still keeps the detents in order.
  const peek = workspaceHeight > 0 ? Math.min(peekPixels / workspaceHeight, half / 2) : PEEK_FALLBACK;
  return { peek, half, full: 1 };
}

/** The detent whose coverage is closest to `cover`. */
export function nearestDetent(cover: number, detents: DetentSet): Detent {
  return DETENT_ORDER.reduce((closest, detent) =>
    Math.abs(detents[detent] - cover) < Math.abs(detents[closest] - cover) ? detent : closest,
  );
}

/**
 * Where a release at `cover` travelling at `velocity` (px/ms, positive downward) should
 * land. Projecting before snapping is what makes a fast flick skip the middle detent while
 * a slow drag settles into it - the same gesture, told apart by speed rather than by
 * distance.
 */
export function projectDetent(cover: number, velocity: number, workspaceHeight: number, detents: DetentSet): Detent {
  if (workspaceHeight <= 0) return nearestDetent(cover, detents);
  // Downward travel reduces coverage, hence the subtraction.
  const landing = cover - (velocity * PROJECTION_MS) / workspaceHeight;
  return nearestDetent(landing, detents);
}

/** The next detent up or down the order, saturating at the ends. */
export function stepDetent(detent: Detent, direction: 1 | -1): Detent {
  const index = DETENT_ORDER.indexOf(detent);
  return DETENT_ORDER[Math.min(DETENT_ORDER.length - 1, Math.max(0, index + direction))];
}

/**
 * Velocity in px/ms from a short trail of samples, positive downward.
 *
 * Deliberately fitted across ~100ms of history rather than the last frame: at 120Hz a
 * single frame delta is dominated by sampling noise, and thresholding on it makes a
 * steady drag register as a flick roughly one time in five.
 */
export interface PointerSample {
  y: number;
  t: number;
}

export const VELOCITY_WINDOW_MS = 100;

export function velocityFrom(samples: readonly PointerSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const first = samples.find((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? samples[0];
  const elapsed = last.t - first.t;
  // Too short a window to divide by: two events in the same millisecond say nothing about
  // speed, and dividing would report an enormous one.
  return elapsed > 8 ? (last.y - first.y) / elapsed : 0;
}

/** Drop samples that have aged out of the velocity window, keeping at least two. */
export function trimSamples(samples: PointerSample[], now: number): PointerSample[] {
  const fresh = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS);
  return fresh.length >= 2 ? fresh : samples.slice(-2);
}
