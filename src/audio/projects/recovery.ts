/**
 * Recovering a project whose saved state cannot be read (DAW-38, the recovery action).
 *
 * The log is the durable truth and `project.json` is a cache of where HEAD got to, so losing the
 * cache is not losing the project: replay is exact (DAW-36 made commands self-contained), and the
 * authority already recovers itself this way in `Room.recomputeHead`. What was missing was the
 * client's side of it - a damaged bundle used to read as "nothing saved here yet", which autosave
 * answered by writing an empty project over the log that could have rebuilt it.
 *
 * Two outcomes, and the second is the one worth designing for. If a rebuild floor exists the project
 * comes back. If it does not - the log no longer reaches the project's first edit and no retained
 * keyframe sits below what is left - nothing here can produce the project that was saved, and the
 * honest answer is a new project beside it rather than a plausible-looking wrong one. Alden's read,
 * and it is right: someone in that position has been away long enough that a fresh start is close to
 * what they expected anyway.
 */
import { ProjectStore } from "../project/projectStore";
import { getRepository, setCurrentProject, UnreadableProjectError, type ProjectRepository } from "../projectRepository";
import { forkProjectFromSnapshot } from "./operations";

export type RecoveryOutcome =
  /** The project came back, and the bundle has been healed: `entries` is how much log it took. */
  | { status: "rebuilt"; entries: number }
  /** Nothing here can rebuild it. The caller offers the fresh project. */
  | { status: "unrebuildable" };

/**
 * Rebuild the current project from its log and write the result back as its keyframe, so the next
 * load is an ordinary one.
 *
 * Healing on the spot rather than holding the rebuilt project in memory is what keeps this a single
 * decision: the caller reloads into a bundle that is simply well-formed, instead of every path
 * downstream having to know it is running on a recovered project.
 */
export async function rebuildProjectState(repo: ProjectRepository = getRepository()): Promise<RecoveryOutcome> {
  const rebuilt = await repo.rebuildFromLog();
  if (!rebuilt) return { status: "unrebuildable" };
  const headSeq = Math.max(-1, ...rebuilt.log.map((entry) => entry.seq), ...rebuilt.notes.map((note) => note.seq));
  await repo.writeKeyframe(rebuilt.project, headSeq);
  return { status: "rebuilt", entries: rebuilt.log.length };
}

/**
 * The fallback: a new project, made the current one, with the damaged bundle left exactly as it was
 * found. It stays in the library, so whatever is still in it stays recoverable by hand or by a later
 * build that can reach further back.
 *
 * It carries nothing, because the case it is reached in is the one where nothing could be rebuilt.
 * Replaying the remaining log onto an empty project would produce a shell: the edits that survive
 * the cap are notes and parameter changes on tracks whose creation is below it, and those are now
 * skipped rather than applied (`applyEdit` guards them), so what came back would be neither the
 * project nor obviously not the project.
 *
 * It is the fork the reconnect conflict dialog uses, for the same reason: a bundle that owns its own
 * history cannot make the original any worse.
 */
export async function startProjectBeside(name: string): Promise<string> {
  const seed = new ProjectStore(); // one default track, as any new project has
  const id = await forkProjectFromSnapshot(seed.snapshot(), name);
  setCurrentProject(id);
  return id;
}

/**
 * Where a damaged project is announced from, because it is found in two places - boot and a project
 * switch - and only one of them is a promise the shell is already holding. The shell subscribes; both
 * callers report. Returns whether `error` was the unreadable-project one, so a caller can fall
 * through to its ordinary logging for anything else.
 */
const listeners = new Set<(detail: string) => void>();

export function subscribeUnreadableProject(listener: (detail: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportUnreadableProject(error: unknown): boolean {
  if (!(error instanceof UnreadableProjectError)) return false;
  for (const listener of listeners) listener(error.detail);
  return true;
}
