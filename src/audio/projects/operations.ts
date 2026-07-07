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
import { getRepository, setCurrentProject, currentProjectId } from "../projectRepository";
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
}

/** Point at a fresh project id, seed a default project into it, and load it. */
async function seedNewProject(deps: ProjectDeps, name: string): Promise<string> {
  const id = newProjectId();
  setCurrentProject(id);
  await getRepository().setName(name);
  const seed = new ProjectStore(); // one default track
  await getRepository().save(seed.snapshot(), [], []);
  await loadCurrentInto(deps);
  return id;
}

/**
 * Boot: adopt the current project. If none exist yet, seed one (the already-seeded
 * live store) as the first project; otherwise open the persisted current (or newest).
 */
export async function initProjects(deps: ProjectDeps, storage: ProjectStorage = getProjectStorage()): Promise<void> {
  const ids = await storage.listProjectIds();
  if (ids.length === 0) {
    const id = newProjectId();
    setCurrentProject(id);
    await getRepository().setName("Untitled");
    await flush(deps); // persist the live (seeded) project as project one
  } else {
    const persisted = currentProjectId();
    setCurrentProject(ids.includes(persisted) ? persisted : ids[0]);
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
    const remaining = (await storage.listProjectIds()).filter((other) => other !== id);
    if (remaining[0]) {
      setCurrentProject(remaining[0]);
      await loadCurrentInto(deps);
    } else {
      await seedNewProject(deps, "Untitled");
    }
  }
  await refreshProjects(storage);
}
