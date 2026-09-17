/**
 * The current user's identity - the author id stamped on this browser's edits. Pure data + a subscribe
 * seam (no React), mirroring the author-colour store (authorColors.ts); a cached snapshot keeps
 * `readCurrentUser` referentially stable for `useSyncExternalStore`.
 *
 * TEMPORARY (pre-auth): identity is a self-chosen handle held in this browser's localStorage, so two
 * tabs / people can set distinct ids and see each other's edits in distinct colours. A `?user=<id>`
 * query param overrides + persists it (handy for opening the same project as two users in two tabs).
 * When real auth lands, the authenticated principal supplies this id and the setter UI is removed - the
 * rest of the app already treats the author as an opaque id (see authorSchema / colorForAuthor), so
 * nothing downstream changes.
 */

/** The default id for a user who has not set one (also the solo-mode author, coloured teal). */
export const DEFAULT_USER = "you";

const STORAGE_KEY = "web-daw:current-user:v1";
const MAX_LEN = 64;
const listeners = new Set<() => void>();

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // localStorage can throw (privacy mode); degrade to the default
  }
}

/** Trim + bound a candidate id; empty/oversized falls back to null (use the default). */
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

/** A `?user=<id>` in the URL (persisted on first read), for quick two-tab / two-user testing. */
function fromQuery(): string | null {
  try {
    if (typeof location === "undefined") return null;
    return clean(new URLSearchParams(location.search).get("user"));
  } catch {
    return null;
  }
}

function readFromStorage(): string {
  const override = fromQuery();
  if (override) {
    store()?.setItem(STORAGE_KEY, override); // sticky, so a later navigation without the param keeps it
    return override;
  }
  return clean(store()?.getItem(STORAGE_KEY)) ?? DEFAULT_USER;
}

let cached = readFromStorage();

/** The current user id (a stable reference until the next write). */
export function readCurrentUser(): string {
  return cached;
}

/** Set the current user id (empty resets to the default) and notify subscribers. */
export function writeCurrentUser(id: string): void {
  cached = clean(id) ?? DEFAULT_USER;
  store()?.setItem(STORAGE_KEY, cached);
  for (const listener of listeners) listener();
}

/** Subscribe to current-user changes. Returns an unsubscribe fn. */
export function subscribeCurrentUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
