/**
 * React binding for a single parameter. Subscribes a component to one param id
 * in a store and returns its current value plus a setter. Uses
 * useSyncExternalStore so React stays consistent with the external store.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { ParamValue } from './types';
import type { ParamStore } from './store';

export function useParam(
  store: ParamStore,
  id: string,
): [ParamValue, (value: ParamValue) => void] {
  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribe((changedId) => {
        if (changedId === id) onChange();
      }),
    [store, id],
  );

  const value = useSyncExternalStore(subscribe, () => store.get(id));
  const setValue = useCallback((next: ParamValue) => store.set(id, next), [store, id]);

  return [value, setValue];
}
