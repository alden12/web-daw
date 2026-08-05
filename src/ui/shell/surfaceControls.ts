/**
 * Where the mounted workspaces publish their own toolbars, as menu-item data, so the touch
 * shell can fold them into the single ⋮ in the top bar (MOBILE-1) instead of every surface
 * rendering a toolbar row of its own. On a 390px screen there is room for one.
 *
 * **Every mounted surface publishes, and the menu shows them all at once.** This used to be a
 * single slot, arbitrated by an `isActiveSurface` prop threaded down through the editor to the
 * roll: whoever was in front owned the ⋮ and the other surface's controls simply were not
 * there. That was the desktop's "focus follows the panel" idea imported to a screen that has
 * no focus - and it read as controls that come and go, since on a phone the arrangement and
 * the roll are both on screen at half cover. Count-in and groove going missing the moment the
 * editor was raised (MOBILE-11) was the same bug wearing a different hat.
 *
 * Publishing under a **key** instead means the arbitration disappears rather than being fixed:
 * there is nothing to decide, so nothing has to be told who is in front. The group order is
 * this module's, not the mount order's, so the menu's shape does not depend on which surface
 * rendered first.
 *
 * A **getter** is published rather than the items themselves. Building `MenuItem[]` from
 * component state produces a fresh array every render, so publishing the array would either
 * notify subscribers on every render or go stale the moment the surface's state changed.
 * Publishing `() => items` - backed by a ref the surface refreshes each render - means the
 * registry changes only when a surface mounts or unmounts, while the shell still reads current
 * values at the moment the menu opens.
 *
 * Pure data plus a subscribe seam, like the other small stores (gridView.ts, currentUser.ts);
 * the React side is `usePublishSurfaceControls`.
 */
import type { MenuItem } from "../Menu";

/**
 * The surfaces that can publish, and the order their groups sit in the menu - top to bottom
 * as they sit on the screen: the arrangement behind, the editor's roll over it. Adding a
 * surface is an entry here plus a `usePublishSurfaceControls` call in it.
 */
export const SURFACE_GROUPS = {
  arrangement: { title: "Arrangement", order: 0 },
  notes: { title: "Notes", order: 1 },
} as const;

export type SurfaceKey = keyof typeof SURFACE_GROUPS;

export interface SurfaceControls {
  key: SurfaceKey;
  /** The heading its rows sit under, so two surfaces both offering "Snap to grid" are telling. */
  title: string;
  items: () => MenuItem[];
}

const listeners = new Set<() => void>();
const published = new Map<SurfaceKey, () => MenuItem[]>();
/**
 * The snapshot `useSyncExternalStore` reads. Held as one array rebuilt only when the set of
 * publishers changes: a getter that built a fresh array per call would re-render forever.
 */
let groups: SurfaceControls[] = [];

function rebuild(): void {
  groups = [...published.entries()]
    .map(([key, items]) => ({ key, title: SURFACE_GROUPS[key].title, items }))
    .sort((first, second) => SURFACE_GROUPS[first.key].order - SURFACE_GROUPS[second.key].order);
  for (const listener of listeners) listener();
}

/** Every mounted surface's controls, in menu order. */
export function readSurfaceControls(): SurfaceControls[] {
  return groups;
}

export function setSurfaceControls(key: SurfaceKey, items: () => MenuItem[]): void {
  if (published.get(key) === items) return;
  published.set(key, items);
  rebuild();
}

/**
 * Retract an entry, but **only if it is still ours**: React can mount a surface's replacement
 * before the old one unmounts, and clearing then would take the live entry with it.
 */
export function clearSurfaceControls(key: SurfaceKey, items: () => MenuItem[]): void {
  if (published.get(key) !== items) return;
  published.delete(key);
  rebuild();
}

export function subscribeSurfaceControls(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
