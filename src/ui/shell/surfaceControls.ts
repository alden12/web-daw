/**
 * Where the active workspace publishes its own toolbar, as menu-item data, so the touch
 * shell can fold it into the single ⋮ in the top bar (MOBILE-1) instead of every surface
 * rendering a toolbar row of its own. On a 390px screen there is room for one.
 *
 * A **getter** is published rather than the items themselves. Building `MenuItem[]` from
 * component state produces a fresh array every render, so publishing the array would
 * either notify subscribers on every render or go stale the moment the surface's state
 * changed. Publishing `() => items` - backed by a ref the surface refreshes each render -
 * means the registry changes only when a surface mounts or unmounts, while the shell
 * still reads current values at the moment the menu opens.
 *
 * Pure data plus a subscribe seam, like the other small stores (gridView.ts,
 * currentUser.ts); the React side is `usePublishSurfaceControls`.
 */
import type { MenuItem } from "../Menu";

export type SurfaceControls = () => MenuItem[];

const listeners = new Set<() => void>();
let active: SurfaceControls | null = null;

/** The active surface's controls, or null when nothing has published any. */
export function readSurfaceControls(): SurfaceControls | null {
  return active;
}

export function setSurfaceControls(next: SurfaceControls | null): void {
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}

export function subscribeSurfaceControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
