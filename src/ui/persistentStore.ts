/**
 * The shared value behind the `usePersistent*` hooks: one raw string per storage key,
 * cached in this module and mirrored to localStorage, with a subscribe seam so every
 * reader of a key sees the same value.
 *
 * **Why shared rather than per-component.** These were once independent `useState`s
 * seeded from storage on mount, so two components reading one key diverged the moment
 * either wrote - the second kept whatever it read when it mounted, forever. That is not
 * hypothetical: `web-daw:metronome` is read by both the transport bar and the touch
 * shell, mounted together, and only stayed correct because one of them was hand-guarded
 * into standing down. See ARCH: editing preferences are app state, not component state.
 *
 * The cache is authoritative once loaded, not localStorage, so a write is visible
 * synchronously even where storage throws (private mode). Cross-tab `storage` events are
 * deliberately not wired up: another tab is another editing session, and pulling its
 * preferences in mid-edit would be a surprise rather than a feature.
 *
 * Pure data plus a subscribe seam, like the other small stores (`gridView.ts`,
 * `currentUser.ts`, `surfaceControls.ts`); the React binding is `usePersistent.ts`.
 */

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - in-memory only */
  }
}

const cache = new Map<string, string | null>();
const listeners = new Map<string, Set<() => void>>();

/** The raw string stored under `key`, or null if never set. Loaded once, then cached. */
export function readPersistent(key: string): string | null {
  if (!cache.has(key)) cache.set(key, readStorage(key));
  return cache.get(key) ?? null;
}

/** Set `key`, mirror it to storage, and notify every reader of that key. */
export function writePersistent(key: string, value: string): void {
  if (readPersistent(key) === value) return;
  cache.set(key, value);
  writeStorage(key, value);
  listeners.get(key)?.forEach((listener) => listener());
}

export function subscribePersistent(key: string, listener: () => void): () => void {
  const forKey = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, forKey);
  forKey.add(listener);
  return () => {
    forKey.delete(listener);
    if (!forKey.size) listeners.delete(key);
  };
}

/** Drop the cache. Tests only - the app has no reason to forget a preference. */
export function resetPersistentCache(): void {
  cache.clear();
  listeners.clear();
}
