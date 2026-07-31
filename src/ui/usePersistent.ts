/**
 * Tiny persisted-state hooks: like useState, but the value is mirrored to localStorage so
 * preferences and panel sizes survive a reload.
 *
 * Every hook on the same key shares one value, held in `persistentStore.ts` - see that
 * file for why (two components on one key used to diverge silently). These are the thin
 * React binding: subscribe to the raw string, parse and clamp it per render.
 */
import { useCallback, useSyncExternalStore } from "react";
import { readPersistent, subscribePersistent, writePersistent } from "./persistentStore";

/**
 * The shared raw value for `key`. Deliberately the *string*, not the parsed value: the
 * snapshot must be identity-stable for `useSyncExternalStore`, and parsing per render is
 * free where returning a fresh object would loop forever.
 */
function useRaw(key: string): string | null {
  const snapshot = useCallback(() => readPersistent(key), [key]);
  return useSyncExternalStore(
    useCallback((listener: () => void) => subscribePersistent(key, listener), [key]),
    snapshot,
    snapshot,
  );
}

/** A number persisted under `key`, clamped to [min, max] on read and write. */
export function usePersistentNumber(key: string, fallback: number, min: number, max: number) {
  const raw = useRaw(key);
  const parsed = raw === null ? NaN : Number(raw);
  const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  const set = useCallback(
    (next: number) => writePersistent(key, String(Math.min(max, Math.max(min, next)))),
    [key, min, max],
  );
  return [value, set] as const;
}

/** A string persisted under `key`, optionally constrained to a set of allowed values. */
export function usePersistentString<T extends string>(key: string, fallback: T, allowed?: readonly T[]) {
  const raw = useRaw(key) as T | null;
  const value = raw === null || (allowed && !allowed.includes(raw)) ? fallback : raw;
  const set = useCallback((next: T) => writePersistent(key, next), [key]);
  return [value, set] as const;
}

/** A boolean persisted under `key`. */
export function usePersistentBoolean(key: string, fallback: boolean) {
  const raw = useRaw(key);
  const value = raw === null ? fallback : raw === "true";
  const set = useCallback((next: boolean) => writePersistent(key, String(next)), [key]);
  return [value, set] as const;
}
