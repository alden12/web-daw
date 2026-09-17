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

/** Fast cadence: coalesce an edit burst, then append the delta to the log. */
const APPEND_DEBOUNCE_MS = 300;
/** Trailing keyframe: rewrite the working snapshot this long after edits stop. */
const KEYFRAME_IDLE_MS = 1500;
/** Cap replay length: force a keyframe once the tail since the last one grows past this. */
const KEYFRAME_MAX_TAIL = 50;

/** The edit log's high-water seq (edits + feed notes share the monotonic counter). */
const highWaterSeq = (entries: { seq: number }[], notes: { seq: number }[]): number =>
  Math.max(-1, ...entries.map((entry) => entry.seq), ...notes.map((note) => note.seq));

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
export function attachAutosave(project: ProjectStore, editLog: EditLog, repo?: ProjectRepository): () => void {
  // Resolve the target at save time, not at attach time: a project switch replaces
  // the current repository (setCurrentProject builds a new one per project), so a
  // captured reference would keep writing the live project into the *previous*
  // project's bundle. Tests inject a fixed repo; production follows the current one.
  const targetRepo = () => repo ?? getRepository();
  let appendTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Write the working snapshot as a keyframe + append any new edits + persist undo. Reused by the
  // forced path (below) and the trailing idle timer. The keyframe is written FIRST so its snapshot
  // already reflects any undo/redo - the appended entries (<= headSeq) then only feed history, and a
  // crash between the two can't resurrect an undone edit.
  const keyframe = async (active: ProjectRepository) => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const entries = editLog.getEntries();
    const notes = editLog.getNotes();
    await active.writeKeyframe(project.snapshot(), highWaterSeq(entries, notes), entries, notes);
    await active.appendEdits(entries);
    await active.writeUndo(editLog.getCheckpoints());
  };

  const tick = async () => {
    const active = targetRepo();
    if (!active) return;
    const entries = editLog.getEntries();
    const notes = editLog.getNotes();
    const keyframeSeq = active.keyframeSeq();
    // Undo/redo can't be replayed forward, so a tail carrying one forces a fresh keyframe.
    const undoRedoPending = entries.some(
      (entry) => entry.seq > keyframeSeq && (entry.kind === "undo" || entry.kind === "redo"),
    );
    const force = keyframeSeq < 0 || undoRedoPending || highWaterSeq(entries, notes) - keyframeSeq >= KEYFRAME_MAX_TAIL;
    if (force) {
      await keyframe(active);
      return;
    }
    // Fast path: append the delta now (durable), rewrite the keyframe only once edits settle.
    await active.appendEdits(entries);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const settled = targetRepo();
      if (settled) void keyframe(settled);
    }, KEYFRAME_IDLE_MS);
  };

  const schedule = () => {
    if (appendTimer) clearTimeout(appendTimer);
    appendTimer = setTimeout(() => void tick(), APPEND_DEBOUNCE_MS);
  };

  // Per-track/group subscriptions are rebuilt on structural change (they come/go).
  let trackUnsubs: (() => void)[] = [];
  const resubscribeTracks = () => {
    for (const unsub of trackUnsubs) unsub();
    trackUnsubs = [
      ...project
        .getTracks()
        .flatMap((track) => [
          ...(track.kind === "instrument"
            ? [track.params.subscribe(schedule), ...track.clips.map((clip) => clip.store.subscribe(schedule))]
            : []),
          ...track.effects.map((effect) => effect.params.subscribe(schedule)),
        ]),
      ...project.getGroups().flatMap((group) => group.effects.map((effect) => effect.params.subscribe(schedule))),
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
    if (appendTimer) clearTimeout(appendTimer);
    if (idleTimer) clearTimeout(idleTimer);
    for (const unsub of trackUnsubs) unsub();
    unsubStructure();
    unsubLog();
  };
}
