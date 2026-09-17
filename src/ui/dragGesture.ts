/**
 * Where the app says "this is one drag" (DAW-8.13).
 *
 * The edit log coalesces successive edits to the same target into one entry, but on its own it can
 * only guess where a run of them ends, by waiting 400ms for the next one. A finger resting on a
 * resize handle crosses that window constantly, so one slow trim became a dozen undo steps, a dozen
 * feed rows, and (before the forward was held) a dozen authoritative edits.
 *
 * A pointer drag knows exactly when it starts and ends, so it says so. Every drag in the app goes
 * through either `beginPointerDrag` (window-tracked drags: notes, clips, placements, resize
 * handles, loop markers) or the capture helpers below (pointer-capture drags: knobs, faders), so
 * the two of them together are the one place this has to be wired.
 *
 * **A registered scope rather than a passed-in log**, because the alternative is threading the edit
 * log through every draggable component to reach code that only wants to bracket the drag. The app
 * shell registers it once; nothing else needs to know it exists.
 */
import type { PointerEvent as ReactPointerEvent } from "react";

/** What a drag tells the edit log. `EditLog` satisfies this as-is. */
export interface DragGestureScope {
  beginGesture(): void;
  endGesture(): void;
}

let scope: DragGestureScope | null = null;

/** Register the scope drags report to (the app shell, once). Null to unregister. */
export function setDragGestureScope(next: DragGestureScope | null): void {
  scope = next;
}

/** Open a drag. Safe with no scope registered, so tests and stories need no wiring. */
export function beginDragGesture(): void {
  scope?.beginGesture();
}

/** Close a drag. Idempotent, so a `pointercancel` after a `pointerup` costs nothing. */
export function endDragGesture(): void {
  scope?.endGesture();
}

/**
 * Take pointer capture and open the drag, for a control that tracks the pointer by capturing it
 * rather than by listening on the window (knobs, faders). The two halves belong together: a capture
 * without a matching release leaks, and so does a gesture.
 */
export function capturePointerDrag(event: ReactPointerEvent<Element>): void {
  event.currentTarget.setPointerCapture(event.pointerId);
  beginDragGesture();
}

/**
 * Release pointer capture and close the drag. Wire it to `onPointerUp` AND `onPointerCancel`: a
 * touch the browser takes over for a scroll never sends a pointerup.
 *
 * Checked rather than released blind, because `releasePointerCapture` throws on a pointer this
 * element never captured - which a release wired to a control that can also be pressed without a
 * drag will eventually be handed.
 */
export function releasePointerDrag(event: ReactPointerEvent<Element>): void {
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  endDragGesture();
}
