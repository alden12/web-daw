/**
 * Where the undo and redo stacks live: `sessionStorage`, per tab (DAW-34 stage E).
 *
 * They used to be a file in the project bundle (`undo.json`), which made them durable and shared -
 * neither of which they should be:
 *
 * - **A redo can never be invalid**, because it names a tombstone and lifting one is always
 *   well-defined; if the tombstone is gone the redo is a no-op. So it needs no guarding, and needs
 *   no more permanence than "put back the thing I just undid" implies.
 * - **Sharing them is worse than useless.** Two tabs on one project would fight over a single redo
 *   list, and one user's stack means nothing to another.
 *
 * `sessionStorage` rather than `localStorage` for exactly that reason: it is per-tab, survives a
 * reload (which is what DAW-8.15 promised), and dies with the tab. The cost, stated plainly: closing
 * a tab loses the stacks, where `undo.json` kept them. A fresh tab derives what it can from the log
 * instead (see `EditLog.deriveUndoStack`) - approximate, but better than nothing.
 *
 * Every access is wrapped: a private window, cleared site data, or a browser set to block storage
 * makes these throw rather than return null, and undo being unavailable must never stop a project
 * from opening.
 */
import type { UndoState } from "./commands/editLog";

const key = (projectId: string): string => `web-daw:undo:${projectId}`;

/** The slice of `Storage` this needs. Injectable so the round trip is testable without a DOM. */
export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `window.sessionStorage`, or null where there is no window at all (the Node MCP server, tests). */
const defaultStore = (): SessionStore | null =>
  typeof window === "undefined" ? null : (window.sessionStorage as SessionStore);

/** The stacks this tab holds for a project, or null when it has none (a fresh tab, or no storage). */
export function readUndoSession(projectId: string, store: SessionStore | null = defaultStore()): UndoState | null {
  try {
    const raw = store?.getItem(key(projectId)) ?? null;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UndoState>;
    const ids = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((each): each is string => typeof each === "string") : [];
    return { undo: ids(parsed.undo), redo: ids(parsed.redo) };
  } catch {
    return null; // no storage, or not JSON: undo is unavailable for this tab, nothing more
  }
}

export function writeUndoSession(
  projectId: string,
  state: UndoState,
  store: SessionStore | null = defaultStore(),
): void {
  try {
    store?.setItem(key(projectId), JSON.stringify(state));
  } catch {
    // Full, blocked, or absent. Undo still works in memory for as long as the tab lives.
  }
}

/** Forget a project's stacks - on delete, so a re-created project of the same id starts clean. */
export function clearUndoSession(projectId: string, store: SessionStore | null = defaultStore()): void {
  try {
    store?.removeItem(key(projectId));
  } catch {
    // Nothing to do: the entry either never existed or is unreachable.
  }
}
