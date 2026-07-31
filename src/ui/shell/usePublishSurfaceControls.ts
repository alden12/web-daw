/**
 * Publish this surface's toolbar to the shell's ⋮ while it is the active one
 * (`surfaceControls.ts`). No-op when `enabled` is false, which is how a surface keeps
 * rendering its own toolbar on desktop and hands it over only on touch.
 *
 * The items are held in a ref refreshed on every render, and only a stable getter is
 * published - so a surface whose controls depend on its own state needs no dependency
 * list here, and the registry does not churn.
 */
import { useEffect, useRef } from "react";
import type { MenuItem } from "../Menu";
import { readSurfaceControls, setSurfaceControls } from "./surfaceControls";

export function usePublishSurfaceControls(items: MenuItem[], enabled: boolean): void {
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
    setSurfaceControls(getter);
    return () => {
      // Only retract our own entry: a sibling surface mounting before this one unmounts
      // (React can overlap them) will have replaced us already, and clearing then would
      // leave the shell's menu empty.
      if (readSurfaceControls() === getter) setSurfaceControls(null);
    };
  }, [enabled]);
}
