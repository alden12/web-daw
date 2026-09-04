/**
 * Two-finger pinch on a scrolling surface (MOBILE-2).
 *
 * This existed as a defect before it existed as a feature: with no handler and no
 * `touch-action` on the scroll containers, a pinch on the timeline or the roll was unclaimed
 * and the browser took it as a **page** zoom, scaling the app's own chrome and breaking the
 * layout. Claiming it locally is the fix; suppressing page zoom globally is not, because it
 * is the only way to read small text everywhere else in the app.
 *
 * ## Why touch events, when everything else here is Pointer Events
 *
 * MOBILE-2 predicted no touch-event path would be needed. That was wrong, and the reason is
 * worth keeping: **a pointer handler cannot refuse a scroll.** `touch-action: pan-x pan-y`
 * leaves the browser free to pan with *two* fingers as well as one, so the browser started
 * panning, took the gesture, and fired `pointercancel` - the zoom moved a pixel and stopped.
 * `preventDefault()` on `pointermove` does not undo a pan already begun; only the touch event
 * underneath it can decline the gesture before the browser commits to it.
 *
 * So: touch events for the two-finger case only, declining it at `touchstart`. One finger is
 * left entirely alone, which keeps native scrolling *and its momentum* - re-implementing pan
 * here would have cost inertia, and inertia is most of what scrolling feels like.
 *
 * ## Two axes, reported separately
 *
 * The roll wants a genuine two-axis pinch (time and pitch scale independently) while the
 * arrangement only zooms time, so the gesture decomposes into a horizontal and a vertical
 * ratio and each surface uses what it has an axis for. Fingers nearly aligned on one axis
 * carry no information about the other - the separation there is a few noisy pixels and its
 * ratio swings wildly - so an axis below `MIN_SEPARATION` reports 1 rather than jerking.
 *
 * ## Ratios are per-move, not since the start
 *
 * The scales they drive are clamped, so a gesture that runs into `ZOOM.max` and comes back
 * would otherwise arrive somewhere other than where it started: absolute ratios keep applying
 * to an unclamped baseline the view no longer has. Incremental factors compose with the clamp
 * instead of fighting it.
 */
import { useEffect, useRef, type RefObject } from "react";

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

/** Absolute separation between the first two touches, per axis. */
function spreadOf(touches: TouchList): { x: number; y: number } {
  const [first, second] = [touches[0], touches[1]];
  return { x: Math.abs(first.clientX - second.clientX), y: Math.abs(first.clientY - second.clientY) };
}

export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  onPinch: (gesture: PinchGesture) => void,
  enabled = true,
): void {
  /**
   * The callback, held so the listeners never have to be re-attached for it.
   *
   * This was a real defect, not a tidy-up. `onPinch` closes over the current zoom, so its
   * identity changes every time the zoom changes - which, in a gesture whose whole job is
   * changing the zoom, is every frame. With it in the dependencies the effect tore itself
   * down and rebuilt mid-pinch, and `lastSpread` went with it: the next move re-baselined
   * instead of zooming, so every other move was swallowed and the gesture crawled.
   */
  const latest = useRef(onPinch);
  // In an effect rather than during render: a ref write during render is not safe under
  // concurrent rendering, where a render can be thrown away after it has already happened.
  useEffect(() => {
    latest.current = onPinch;
  }, [onPinch]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    let lastSpread: { x: number; y: number } | null = null;
    // Ratios accumulated since the last frame, and where the fingers were when we last looked.
    // Touch moves arrive faster than React commits, so reporting each one separately means
    // every call in a frame reads the same stale scale and only the last survives - a pinch
    // that should treble the zoom lands at under twice. Multiplying them up and emitting once
    // per frame keeps the whole gesture and gives the anchoring a committed layout to measure.
    let pending: { x: number; y: number; clientX: number; clientY: number } | null = null;
    let frame = 0;

    const flush = () => {
      frame = 0;
      const gesture = pending;
      pending = null;
      if (gesture)
        latest.current({ scaleX: gesture.x, scaleY: gesture.y, clientX: gesture.clientX, clientY: gesture.clientY });
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        lastSpread = null;
        return;
      }
      // Decline the gesture here, before the browser commits to panning with it. This is the
      // call that a pointer handler has no equivalent of, and without it the pinch dies on
      // its first move.
      event.preventDefault();
      lastSpread = spreadOf(event.touches);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();

      const spread = spreadOf(event.touches);
      if (!lastSpread) {
        lastSpread = spread;
        return;
      }
      const ratio = (now: number, before: number) =>
        now >= MIN_SEPARATION && before >= MIN_SEPARATION ? now / before : 1;
      const [first, second] = [event.touches[0], event.touches[1]];
      pending = {
        x: (pending?.x ?? 1) * ratio(spread.x, lastSpread.x),
        y: (pending?.y ?? 1) * ratio(spread.y, lastSpread.y),
        clientX: (first.clientX + second.clientX) / 2,
        clientY: (first.clientY + second.clientY) / 2,
      };
      if (!frame) frame = requestAnimationFrame(flush);
      lastSpread = spread;
    };

    const onTouchEnd = (event: TouchEvent) => {
      // Rebaseline rather than resume: lifting one finger of three, or one of two and
      // replacing it, must not read the jump between old and new fingers as a zoom.
      lastSpread = event.touches.length === 2 ? spreadOf(event.touches) : null;
    };

    // Non-passive, or `preventDefault` is ignored and the browser scrolls anyway.
    element.addEventListener("touchstart", onTouchStart, { passive: false });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchEnd);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [ref, enabled]);
}
