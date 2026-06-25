/**
 * React binding for the clip store. Re-renders the component whenever the clip
 * changes. The store returns a stable snapshot reference between mutations, so
 * useSyncExternalStore stays loop-free.
 */
import { useSyncExternalStore } from "react";
import type { ClipData } from "./types";
import type { ClipStore } from "./clipStore";

export function useClip(store: ClipStore): ClipData {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getClip(),
  );
}
