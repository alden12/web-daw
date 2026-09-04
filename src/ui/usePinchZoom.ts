/**
 * Two-finger pinch on a scrolling surface (MOBILE-2).
 *
 * This existed as a defect before it existed as a feature: with no handler and no
 * `touch-action` on the scroll containers, a pinch on the timeline or the roll was unclaimed
 * and the browser took it as a **page** zoom, scaling the app's own chrome and breaking the
 * layout. Claiming it locally is the fix; suppressing page zoom globally is not, because it
 * is the only way to read small text everywhere else in the app.
 *
 * Pointer Events give us multiple pointers, so no touch-event path is needed and this sits on
 * the same primitive every other drag in the app uses.
 *
 * **Two axes, reported separately.** The roll wants a genuine two-axis pinch (time and pitch
 * scale independently) while the arrangement only zooms time, so the gesture decomposes into
 * a horizontal and a vertical ratio and each surface uses what it has an axis for. A pinch
 * whose fingers are nearly aligned on one axis carries no information about the other - the
 * separation there is a few noisy pixels and its ratio swings wildly - so an axis below
 * `MIN_SEPARATION` reports 1 rather than a number that would jerk the view.
 *
 * **Ratios are per-move, not since the start.** The scales they drive are clamped, so a
 * gesture that runs into `ZOOM.max` and comes back would otherwise arrive somewhere other
 * than where it started: absolute ratios keep applying to an unclamped baseline the view no
 * longer has. Incremental factors compose with the clamp instead of fighting it.
 */
import { useEffect, type RefObject } from "react";

/** Below this many pixels apart on an axis, a pinch says nothing about that axis. */
const MIN_SEPARATION = 24;

export interface PinchGesture {
  /** Horizontal scale since the last move. 1 when the fingers say nothing about this axis. */
  scaleX: number;
  /** Vertical scale since the last move. */
  scaleY: number;
  /** The midpoint between the fingers, to anchor the zoom on. */
  clientX: number;
  clientY: number;
}

export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  onPinch: (gesture: PinchGesture) => void,
  enabled = true,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    // Live pointers on this surface, by id. A pinch is exactly the two-pointer case; one is
    // an ordinary drag and belongs to whatever the finger landed on, and three or more is not
    // a gesture we have a meaning for.
    const points = new Map<number, { x: number; y: number }>();
    let lastSpread: { x: number; y: number } | null = null;

    const spreadOf = () => {
      const [first, second] = [...points.values()];
      return { x: Math.abs(first.x - second.x), y: Math.abs(first.y - second.y) };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      lastSpread = points.size === 2 ? spreadOf() : null;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!points.has(event.pointerId)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (points.size !== 2) return;

      const spread = spreadOf();
      if (!lastSpread) {
        lastSpread = spread;
        return;
      }
      // The gesture is ours from here: without this the surface also scrolls under the pinch,
      // because `touch-action: pan-x pan-y` deliberately leaves one-finger panning alone.
      event.preventDefault();

      const ratio = (now: number, before: number) =>
        now >= MIN_SEPARATION && before >= MIN_SEPARATION ? now / before : 1;
      const [first, second] = [...points.values()];
      onPinch({
        scaleX: ratio(spread.x, lastSpread.x),
        scaleY: ratio(spread.y, lastSpread.y),
        clientX: (first.x + second.x) / 2,
        clientY: (first.y + second.y) / 2,
      });
      lastSpread = spread;
    };

    const onPointerUp = (event: PointerEvent) => {
      points.delete(event.pointerId);
      // Rebaseline rather than resume: lifting one finger of three, or one of two and
      // replacing it, must not read the jump between old and new fingers as a zoom.
      lastSpread = points.size === 2 ? spreadOf() : null;
    };

    element.addEventListener("pointerdown", onPointerDown);
    // On the element, and not passive, so `preventDefault` can take the gesture back from the
    // scroller once we know it is a pinch.
    element.addEventListener("pointermove", onPointerMove, { passive: false });
    // On the window, because a finger can leave the element before it lifts and a pinch that
    // never ends leaves the next one baselined against a stale spread.
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [ref, onPinch, enabled]);
}
