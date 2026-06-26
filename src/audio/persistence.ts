/**
 * Project persistence: restore the saved project + authored edit log into the
 * stores on startup, and autosave on any change. Both go through the
 * `ProjectRepository` seam (a bundle of project.json + log + content-addressed
 * samples - see `projectRepository.ts`), so the storage backend (OPFS now, a disk
 * folder or remote later) is swappable without touching this file. The log rides
 * along in the same save so the activity feed and authored history survive a reload
 * (undo/redo is session-scoped and intentionally not persisted).
 */
import type { ProjectStore } from "./project/projectStore";
import type { EditLog } from "./commands/editLog";
import { getRepository, type ProjectRepository } from "./projectRepository";

const SAVE_DEBOUNCE_MS = 300;

/** Restore the saved project + edit log into the stores, if present. Await this
 *  before wiring sync, so the first MCP snapshot reflects the restored project. */
export async function restoreProject(
  project: ProjectStore,
  editLog: EditLog,
  repo: ProjectRepository = getRepository(),
): Promise<void> {
  const saved = await repo.load();
  if (!saved || !saved.project.tracks?.length) return;
  project.load(saved.project);
  editLog.restore(saved.log, saved.notes);
  // Layer persisted undo/redo back on, so undo works after a reload.
  const undo = await repo.readUndo();
  if (undo) editLog.restoreCheckpoints(undo);
}

/**
 * Debounced autosave on any structural OR per-track (param/clip) change, plus any
 * edit-log change. The log + feed notes ride along in the same write. Most edits
 * mutate the project (caught by the structural/track subscriptions), but a feed
 * note changes no project state, so we also subscribe to the edit log - otherwise a
 * note posted with no following edit would never be saved. Returns a disposer.
 * Re-subscribes to track stores whenever the track set changes.
 */
export function attachAutosave(
  project: ProjectStore,
  editLog: EditLog,
  repo: ProjectRepository = getRepository(),
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void repo.save(project.snapshot(), editLog.getEntries(), editLog.getNotes());
      void repo.writeUndo(editLog.getCheckpoints()); // persist undo/redo so it survives a reload
    }, SAVE_DEBOUNCE_MS);
  };

  // Per-track/group subscriptions are rebuilt on structural change (they come/go).
  let trackUnsubs: (() => void)[] = [];
  const resubscribeTracks = () => {
    for (const u of trackUnsubs) u();
    trackUnsubs = [
      ...project
        .getTracks()
        .flatMap((t) => [
          ...(t.kind === "instrument"
            ? [t.params.subscribe(schedule), ...t.clips.map((c) => c.store.subscribe(schedule))]
            : []),
          ...t.effects.map((fx) => fx.params.subscribe(schedule)),
        ]),
      ...project.getGroups().flatMap((g) => g.effects.map((fx) => fx.params.subscribe(schedule))),
    ];
  };

  const unsubStructure = project.subscribe(() => {
    resubscribeTracks();
    schedule();
  });
  resubscribeTracks();
  // Catch log-only changes (a feed note mutates no project state).
  const unsubLog = editLog.subscribe(schedule);

  return () => {
    if (timer) clearTimeout(timer);
    for (const u of trackUnsubs) u();
    unsubStructure();
    unsubLog();
  };
}
