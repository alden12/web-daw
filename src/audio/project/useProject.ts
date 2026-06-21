/**
 * React binding for the project structure (tracks, tempo, selection). Re-renders
 * on structural changes. Per-track param/clip views use useParam/useClip on the
 * track's own stores.
 */
import { useSyncExternalStore } from 'react';
import type { ProjectStore, ProjectStructure } from './projectStore';

export function useProject(store: ProjectStore): ProjectStructure {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getStructure(),
  );
}
