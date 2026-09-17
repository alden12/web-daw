/**
 * Imperative project-library flows: boot, switch, create, rename, delete. These
 * touch the live objects (ProjectStore, EditLog, VersionStore), so they live apart
 * from the pure library store.
 *
 * A switch is the import-in-place flow: flush the current project, repoint the
 * repository to the target bundle, load it into the live store, and reload version
 * history. Everything else (engine graph, MCP mirror, autosave) re-derives from the
 * `projectStore.load` emit, and the AudioContext is preserved.
 */
import { ProjectStore } from "../project/projectStore";
import type { EditLog } from "../commands/editLog";
import type { VersionStore } from "../commands/history";
import type { ProjectData } from "../project/types";
import {
  getRepository,
  setCurrentProject,
  currentProjectId,
  markProjectLoaded,
  ProjectRepository,
} from "../projectRepository";
import { getProjectStorage, type ProjectStorage } from "../bundleStore";
import { newProjectId, refreshProjects } from "./library";

export interface ProjectDeps {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
}

/** Persist the live project into its bundle now (so a switch never loses recent edits). */
async function flush(deps: ProjectDeps): Promise<void> {
  const repo = getRepository();
  await repo.save(deps.projectStore.snapshot(), deps.editLog.getEntries(), deps.editLog.getNotes());
  await repo.writeUndo(deps.editLog.getCheckpoints());
}

/** Load the current project's bundle into the live objects (+ reload history). */
async function loadCurrentInto(deps: ProjectDeps): Promise<void> {
  const repo = getRepository();
  const saved = await repo.load();
  if (saved && saved.project.tracks?.length) {
    deps.projectStore.load(saved.project);
    deps.editLog.restore(saved.log, saved.notes);
    deps.editLog.restoreCheckpoints(await repo.readUndo());
  }
  await deps.versionStore.reload();
  // The store now holds this project, so anything pairing the current id with what it reads
  // off the store (the URL, the header) can trust the two agree again.
  markProjectLoaded(currentProjectId());
}

/** Point at a fresh project id, seed a default project into it, and load it. */
async function seedNewProject(deps: ProjectDeps, name: string): Promise<string> {
  const id = newProjectId();
  setCurrentProject(id);
  await getRepository().setName(name);
  const seed = new ProjectStore(); // one default track
  seed.renameProject(name); // carry the name in project.json (state), not only meta.json
  await getRepository().save(seed.snapshot(), [], []);
  await loadCurrentInto(deps);
  return id;
}

/**
 * Boot's options. The other operations here take `storage` as a trailing parameter; boot is the
 * only one with a second thing to say, so it names both rather than growing a positional gap.
 */
type InitProjectsOptions = {
  /** Injectable for tests; defaults to the app-wide storage. */
  storage?: ProjectStorage;
  /**
   * The project a link asked for (`null` when the URL named none). It wins over the persisted
   * current, but **only if it is really there**: opening a link to a project you cannot see
   * (signed out, or never shared with you) must fall back to your own, not seed a local
   * project under someone else's id.
   */
  preferId?: string | null;
};

/**
 * Boot: adopt the current project. If none exist yet, seed one (the already-seeded
 * live store) as the first project; otherwise open the project a link asked for, the
 * persisted current, or the newest.
 */
export async function initProjects(
  deps: ProjectDeps,
  { storage = getProjectStorage(), preferId }: InitProjectsOptions = {},
): Promise<void> {
  const ids = (await storage.listProjects()).map((project) => project.id);
  if (ids.length === 0) {
    // Seed the first project under a *stable* id (the persisted current, or "default"),
    // not a fresh random one: boot can run twice (React StrictMode double-invokes the
    // mount effect in dev), and two random ids would seed two projects. A stable id
    // makes the second pass a harmless re-flush of the same bundle.
    setCurrentProject(currentProjectId());
    await getRepository().setName("Untitled");
    await flush(deps); // persist the live (seeded) project as project one
    // This branch never loads: the live store was already seeded, so it *is* this project.
    // Marking it anyway is what lets the URL sync at all on a fresh install.
    markProjectLoaded(currentProjectId());
  } else {
    // Open the first candidate that is really there: the project a link asked for, else the
    // persisted current, else the newest. Both of the first two can name something gone (see
    // `preferId`, and a stale `localStorage` pointing at a deleted project), so both are checked.
    const ifPresent = (id: string | null | undefined): string | null => (id && ids.includes(id) ? id : null);
    setCurrentProject(ifPresent(preferId) ?? ifPresent(currentProjectId()) ?? ids[0]);
    await loadCurrentInto(deps);
  }
  await refreshProjects(storage);
}

/** Switch to another saved project (flushes the current one first). No-op if already current. */
export async function switchProject(
  deps: ProjectDeps,
  id: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<void> {
  if (id === currentProjectId()) return;
  await flush(deps);
  setCurrentProject(id);
  await loadCurrentInto(deps);
  await refreshProjects(storage);
}

/** Create a new empty project and switch to it. Returns its id. */
export async function createProject(
  deps: ProjectDeps,
  name = "Untitled",
  storage: ProjectStorage = getProjectStorage(),
): Promise<string> {
  await flush(deps);
  const id = await seedNewProject(deps, name);
  await refreshProjects(storage);
  return id;
}

/**
 * Fork a new project seeded from a given snapshot (not the live store). Used by the reconnect
 * conflict flow's "keep mine as a copy": the copy carries this client's optimistic (offline) state,
 * leaving the original to converge on the peer's. The copy starts with a fresh history (the snapshot is
 * its first keyframe) and is owned by the creator, unshared. Does NOT flush or load the live store - the
 * caller reloads into the new id afterwards - so the current project is left untouched.
 */
export async function forkProjectFromSnapshot(
  snapshot: ProjectData,
  name: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<string> {
  const id = newProjectId();
  const seed = new ProjectStore(false);
  seed.load(snapshot);
  seed.renameProject(name); // carry the copy's name in project.json (state), like seedNewProject
  // Write through a standalone repository (not the live singleton) so the bundle gets the canonical
  // manifest + keyframe layout without repointing the current project. Empty history: the snapshot is
  // the copy's first keyframe.
  const repo = new ProjectRepository(storage.bundle(id), id);
  await repo.setName(name);
  await repo.save(seed.snapshot(), [], []);
  await refreshProjects(storage);
  return id;
}

/** Rename a project (the current one via the live repo, else its bundle's meta). */
export async function renameProject(
  id: string,
  name: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<void> {
  if (id === currentProjectId()) {
    await getRepository().setName(name);
  } else {
    await storage.bundle(id).writeText("meta.json", JSON.stringify({ name, modifiedAt: new Date().toISOString() }));
  }
  await refreshProjects(storage);
}

/** Delete a project. If it was current, fall back to another (or a fresh one). */
export async function deleteProject(
  deps: ProjectDeps,
  id: string,
  storage: ProjectStorage = getProjectStorage(),
): Promise<void> {
  const wasCurrent = id === currentProjectId();
  await storage.deleteProject(id);
  if (wasCurrent) {
    // Don't flush (that would resurrect the deleted bundle); repoint directly.
    const remaining = (await storage.listProjects()).map((project) => project.id).filter((other) => other !== id);
    if (remaining[0]) {
      setCurrentProject(remaining[0]);
      await loadCurrentInto(deps);
    } else {
      await seedNewProject(deps, "Untitled");
    }
  }
  await refreshProjects(storage);
}
