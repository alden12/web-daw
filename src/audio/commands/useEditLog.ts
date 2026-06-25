/**
 * React binding for the edit log (activity feed, undo/redo button state).
 * Re-renders when an edit is dispatched or undo/redo runs.
 */
import { useSyncExternalStore } from 'react';
import type { EditLog, EditLogState } from './editLog';

export function useEditLog(log: EditLog): EditLogState {
  return useSyncExternalStore(
    (onChange) => log.subscribe(onChange),
    () => log.getState(),
  );
}
