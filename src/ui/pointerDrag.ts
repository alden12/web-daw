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
 *
 * It also brackets the drag as one edit-log gesture (see `dragGesture.ts`), so a drag that edits
 * the project is one undo step and one authoritative edit however long it takes - no draggable has
 * to remember to do that for itself (DAW-8.13).
 */
import { beginDragGesture, endDragGesture } from "./dragGesture";

export function beginPointerDrag(onMove: (event: PointerEvent) => void, onEnd?: (event: PointerEvent) => void): void {
  const finish = (event: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    // `onEnd` before the gesture closes: a handler that dispatches a final edit (dropping a clip
    // where the drag ended) belongs to the drag, not to whatever comes after it.
    onEnd?.(event);
    endDragGesture();
  };
  beginDragGesture();
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  // A touch the browser takes over (a scroll, a gesture) sends pointercancel and no pointerup.
  // Without this the listeners leaked and the gesture stayed open until the next drag closed it.
  window.addEventListener("pointercancel", finish);
}
