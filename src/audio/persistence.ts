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
/**
 * Rewrite the (expensive) `project.json` keyframe once the replay tail since the last one grows past
 * this many edits. This is the PRIMARY keyframe trigger: keyframes bound load-time replay, not
 * durability (the delta append is durable), and replay is cheap - so we keyframe on edit *count*, not
 * on an idle timer that fired a full-bundle write after every editing pause. A starting value, tunable
 * once large-project testing reveals the real assemble-from-deltas vs write-a-keyframe crossover.
 */
const KEYFRAME_EDIT_INTERVAL = 100;

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

  // Write the working snapshot as a keyframe + append the stream delta (edits + notes).
  // The keyframe is written FIRST so its snapshot already reflects any undo/redo - the appended entries
  // (<= headSeq) then only feed history, and a crash between the two can't resurrect an undone edit.
  const keyframe = async (active: ProjectRepository) => {
    const entries = editLog.getEntries();
    const notes = editLog.getNotes();
    await active.writeKeyframe(project.snapshot(), highWaterSeq(entries, notes));
    await active.appendEdits(entries, notes);
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
    const needKeyframe =
      keyframeSeq < 0 || undoRedoPending || highWaterSeq(entries, notes) - keyframeSeq >= KEYFRAME_EDIT_INTERVAL;
    // Keyframe-first when needed (crash-safe for undo/redo); otherwise append the stream delta
    // (edits + feed notes) - notes ride the delta now, so they persist without waiting for a keyframe.
    if (needKeyframe) await keyframe(active);
    else await active.appendEdits(entries, notes);
  };

  // Flush on page-hide: send whatever the debounce is still holding (an in-progress edit burst never
  // pauses long enough to append) plus a meta touch, so a short session or a tab close does not lose
  // the tail. Best-effort (fire-and-forget during unload); the delta stream already made everything up
  // to the last pause durable. project.json is intentionally NOT keyframed here - it is rebuilt by
  // replay on next load, and keeping the unload payload small keeps it reliable.
  const flush = () => {
    if (appendTimer) clearTimeout(appendTimer);
    appendTimer = null;
    const active = targetRepo();
    if (!active) return;
    void active.appendEdits(editLog.getEntries(), editLog.getNotes());
    void active.touchMeta();
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

  // Flush the pending tail when the tab is backgrounded or closed. Guarded for non-DOM hosts (tests).
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  if (hasDom) {
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
  }

  return () => {
    if (appendTimer) clearTimeout(appendTimer);
    for (const unsub of trackUnsubs) unsub();
    unsubStructure();
    unsubLog();
    if (hasDom) {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    }
  };
}

/**
 * Persist the undo/redo stacks, so undo survives a reload (DAW-8.15).
 *
 * **Its own attachment, because it is the one thing both persistence modes need.** Local projects
 * are saved by `attachAutosave`; a hosted project is saved by the `SharedSession` instead, and
 * `attachAutosave` is deliberately not attached there (the authority owns the log and the
 * keyframes). Undo fell in the gap: it was written inside the autosave keyframe, so hosted
 * sessions never wrote it at all, and local ones wrote it once per 100 edits. Both restored a
 * stack from far in the past, and a checkpoint is a whole-project snapshot, so undoing against one
 * threw the project back to that older state rather than taking back the last edit.
 *
 * **Idle-debounced rather than written per edit**, which is what lets it be correct AND cheap. The
 * stacks are the largest thing in the bundle (a full `ProjectData` base plus up to 30 commands),
 * so writing them on the 300ms append debounce would put ~50KB on the wire per editing burst. And
 * a slow cadence costs nothing here, because `headSeq` only rejects a stack that trails the log:
 * to lose undo you have to reload within a second and a half of your last edit, having spent that
 * time neither editing nor pausing. What the guard cannot forgive is a cadence that never catches
 * up when you stop, which is exactly what keyframing every 100 edits was.
 */
const UNDO_PERSIST_MS = 1500;

export function attachUndoPersistence(editLog: EditLog, repo?: ProjectRepository): () => void {
  // Resolved per write, not captured: a project switch replaces the repository, and a captured one
  // would write this project's stacks into the previous project's bundle.
  const targetRepo = () => repo ?? getRepository();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = () => {
    const active = targetRepo();
    if (!active) return;
    // Failures are the caller's business to notice, not this timer's to crash on: a stack that did
    // not land is caught by `headSeq` on the next load and discarded rather than misapplied.
    void active.writeUndo(editLog.getCheckpoints()).catch(() => {});
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(write, UNDO_PERSIST_MS);
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    write();
  };

  const unsubLog = editLog.subscribe(schedule);

  // Page-hide is when a pending stack is most likely to be lost, so spend the debounce early there.
  // Best-effort during unload, like the autosave flush beside it.
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  const hasDom = typeof document !== "undefined" && typeof window !== "undefined";
  if (hasDom) {
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
  }

  return () => {
    if (timer) clearTimeout(timer);
    unsubLog();
    if (hasDom) {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    }
  };
}
