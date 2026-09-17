/**
 * The project library: the set of saved projects, each its own bundle under
 * `projects/<id>/`. This is the browser-facing store the rail's Project view reads -
 * a cached list + a subscribe seam, refreshed by asking the project storage for its
 * listings. Mirrors the patches-library shape, but async and cached, since reads can't
 * be synchronous.
 *
 * The listing (id + name + modifiedAt + the caller's role) comes straight from the storage
 * seam: the remote backend returns it in one request (owned + shared projects), the local
 * backends read each bundle's meta.json. The current-project pointer lives in
 * `projectRepository` (a shared localStorage key); the imperative flows
 * (create/switch/rename/delete) live in `operations.ts`.
 */
import { getProjectStorage, type ProjectListing, type ProjectStorage } from "../bundleStore";

/** A project in the library list. Re-exported from the storage seam (id + name + modifiedAt + role). */
export type ProjectMeta = ProjectListing;

let cache: ProjectMeta[] = [];
const listeners = new Set<() => void>();

/** The cached project list, newest-first. Call `refreshProjects` to (re)populate it. */
export function listProjects(): ProjectMeta[] {
  return cache;
}

/** Subscribe to library changes (refresh/create/rename/delete). Returns an unsubscribe fn. */
export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Patch one project's cached name in place (and notify subscribers). Used when a `renameProject` edit
 * arrives from a collaborator: the peer already applied it to the live store, so we update the list label
 * straight from the edit rather than re-reading the server (race-free, instant). A no-op if the id isn't
 * in the cache yet (a later refresh will pick it up from the now-authoritative `projects.name`).
 */
export function patchProjectName(id: string, name: string): void {
  const next = name.trim() || "Untitled";
  let changed = false;
  cache = cache.map((meta) =>
    meta.id === id && meta.name !== next ? ((changed = true), { ...meta, name: next }) : meta,
  );
  if (changed) emit();
}

/** Ask the storage for its listings, sort newest-first, update + notify the cache. */
export async function refreshProjects(storage: ProjectStorage = getProjectStorage()): Promise<ProjectMeta[]> {
  const metas = await storage.listProjects();
  cache = [...metas].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  emit();
  return cache;
}

/** A fresh project id. */
export function newProjectId(): string {
  return `p-${crypto.randomUUID().slice(0, 8)}`;
}
