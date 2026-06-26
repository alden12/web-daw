/**
 * The window-level pointer-drag boilerplate, in one place. A drag starts in a
 * `pointerdown` handler and then has to track the pointer across the whole window
 * (not just the element) until release - so every draggable thing (notes, clips,
 * placements, resize handles, ruler loop markers) registered the same pair of
 * `pointermove` / `pointerup` window listeners and tore them down on release.
 *
 * Call `beginPointerDrag(onMove, onEnd)` from inside the pointerdown handler: it
 * wires the listeners and cleans them up on pointerup (running `onEnd` for any
 * per-drag teardown the caller needs - clearing drag state, resetting a cursor).
 * `onEnd` receives the pointerup event, so a handler that needs the release
 * position (e.g. drop a clip where the drag ended) can read it.
 */
export function beginPointerDrag(onMove: (event: PointerEvent) => void, onEnd?: (event: PointerEvent) => void): void {
  const onUp = (event: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    onEnd?.(event);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
