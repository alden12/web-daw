/**
 * Replaying the edit log: the one place that knows how a stream of entries becomes a project.
 *
 * Four callers replay: loading a local bundle, loading a room on the server, catching a client up
 * after a reconnect, and - the reason this file exists - **rebuilding a project with an edit left
 * out**, which is how undo works from DAW-34 stage C on. Each of the first three had its own copy of
 * `isReplayable`, which is the sort of thing that drifts exactly once and then quietly means two
 * different things.
 *
 * Rebuilding without an edit is only exact if replay is exact, which is what DAW-36 bought: a
 * command carries what it needs rather than reading it from whatever the project happens to look
 * like at the time. Without that, leaving an edit out silently changed later ones.
 */
import { ProjectStore } from "../project/projectStore";
import type { ProjectData } from "../project/types";
import { applyEdit } from "./applyEdit";
import type { Author, EditCommand, EditEntry } from "./types";

/**
 * Whether an entry is applied going forward. Feed notes carry no project change, and the undo/redo
 * reflog markers record that something was taken back rather than doing it. A missing `kind` is an
 * edit written before the field existed.
 *
 * Takes a plain `string` rather than `EditEntry["kind"]` because two of the callers read entries
 * straight out of storage, where the column is a string and an unknown value must read as "not an
 * edit" rather than fail to compile.
 */
export const isReplayable = (kind: string | undefined): boolean => kind === undefined || kind === "edit";

export interface ReplayOptions {
  /**
   * Entry *ids* to leave out: the edits being undone. Everything else replays as usual.
   *
   * Ids rather than seqs, because `seq` is an order the authority reassigns while an undo step has
   * to keep naming the same edit (see `EditEntry.id`). An entry with no id can never be excluded,
   * which is the safe direction: it replays, so the project is what the log says.
   */
  readonly excluding?: ReadonlySet<string>;
  /** Replay only entries above this seq - the base snapshot already reflects the rest. */
  readonly above?: number;
}

/** Apply a stream of entries to a store, in the order given. Mutates; returns nothing. */
export function replayEntries(project: ProjectStore, entries: readonly EditEntry[], options: ReplayOptions = {}): void {
  const { excluding, above } = options;
  for (const entry of entries) {
    if (above !== undefined && entry.seq <= above) continue;
    if (entry.id !== undefined && excluding?.has(entry.id)) continue;
    if (!isReplayable(entry.kind)) continue;
    applyEdit(project, entry.command as EditCommand, entry.author as Author);
  }
}

/**
 * The project as it would be if `excluding` had never been dispatched: the base snapshot, then every
 * entry above it replayed except those (DAW-34 stage C).
 *
 * This is the whole of undo. There is no per-command inverse to write or maintain, it handles
 * undoing an edit that is not the most recent one without any extra reasoning, and it cannot be
 * subtly wrong in the way a hand-written inverse can, because the only thing it asserts is that the
 * remaining edits still mean what they said.
 *
 * `base` must reflect exactly `baseSeq`, and the entries must run unbroken from there.
 */
export function rebuildWithout(
  base: ProjectData,
  baseSeq: number,
  entries: readonly EditEntry[],
  excluding: ReadonlySet<string>,
): ProjectData {
  const project = new ProjectStore(false);
  project.load(base);
  replayEntries(project, entries, { above: baseSeq, excluding });
  return project.snapshot();
}
