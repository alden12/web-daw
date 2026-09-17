/**
 * Publish this surface's toolbar to the shell's ⋮ under its own key (`surfaceControls.ts`).
 * No-op when `enabled` is false, which is how a surface keeps rendering its own toolbar on
 * desktop and hands it over only on touch.
 *
 * There is no "is this the active surface?" argument: every mounted surface publishes and the
 * menu shows them all - see the note in `surfaceControls.ts` for why that turned out to be the
 * simplification rather than a feature.
 *
 * The items are held in a ref refreshed on every render, and only a stable getter is published
 * - so a surface whose controls depend on its own state needs no dependency list here, and the
 * registry does not churn.
 */
import { useEffect, useRef } from "react";
import type { MenuItem } from "../Menu";
import { clearSurfaceControls, setSurfaceControls, type SurfaceKey } from "./surfaceControls";

export function usePublishSurfaceControls(key: SurfaceKey, items: MenuItem[], enabled: boolean): void {
  const itemsRef = useRef(items);
  // Refreshed after every commit (no dependency list), not during render - a ref written
  // mid-render is not safe under concurrent rendering. The initial value comes from
  // `useRef` above, so the getter is never stale even before the first effect runs.
  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    if (!enabled) return;
    const getter = () => itemsRef.current;
    setSurfaceControls(key, getter);
    return () => clearSurfaceControls(key, getter);
  }, [key, enabled]);
}
