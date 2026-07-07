/**
 * The project library: the set of saved projects, each its own bundle under
 * `projects/<id>/`. This is the browser-facing store the rail's Project view reads -
 * a cached list + a subscribe seam, refreshed by enumerating the project storage and
 * reading each bundle's `meta.json`. Mirrors the patches-library shape, but async
 * (OPFS enumeration) and cached, since reads can't be synchronous.
 *
 * The current-project pointer lives in `projectRepository` (a shared localStorage key)
 * so the repository singleton and this library agree on which bundle is active; the
 * imperative flows (create/switch/rename/delete) live in `operations.ts`.
 */
import { getProjectStorage, type ProjectStorage } from "../bundleStore";

export interface ProjectMeta {
  id: string;
  name: string;
  /** ISO timestamp of the last save; "" if never written. */
  modifiedAt: string;
}

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

async function readMeta(storage: ProjectStorage, id: string): Promise<ProjectMeta> {
  const raw = await storage.bundle(id).readText("meta.json");
  try {
    const meta = JSON.parse(raw ?? "") as { name?: string; modifiedAt?: string };
    return { id, name: meta.name || id, modifiedAt: meta.modifiedAt ?? "" };
  } catch {
    return { id, name: id, modifiedAt: "" };
  }
}

/** Enumerate the stored projects, read their metadata, update + notify the cache. */
export async function refreshProjects(storage: ProjectStorage = getProjectStorage()): Promise<ProjectMeta[]> {
  const ids = await storage.listProjectIds();
  const metas = await Promise.all(ids.map((id) => readMeta(storage, id)));
  metas.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  cache = metas;
  emit();
  return cache;
}

/** A fresh project id. */
export function newProjectId(): string {
  return `p-${crypto.randomUUID().slice(0, 8)}`;
}
