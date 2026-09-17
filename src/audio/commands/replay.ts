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

/**
 * The ids the log itself says are taken back, as of `upTo` (default: the whole log).
 *
 * Walks in order, because an undo and a redo of the same edit are both tombstones and the later one
 * wins. `upTo` is what keeps an older state true: replaying only as far as some seq honours only
 * the tombstones at or below it, so a past point does not acquire undos made after it.
 */
export function tombstonedIds(entries: readonly EditEntry[], upTo?: number): Set<string> {
  const excluded = new Set<string>();
  for (const entry of entries) {
    if (upTo !== undefined && entry.seq > upTo) continue;
    if (entry.undoes === undefined) continue;
    if (entry.kind === "undo") excluded.add(entry.undoes);
    else if (entry.kind === "redo") excluded.delete(entry.undoes);
  }
  return excluded;
}

export interface ReplayOptions {
  /**
   * Further entry *ids* to leave out, on top of the log's own tombstones: edits undone locally and
   * not yet part of the stream.
   *
   * Ids rather than seqs, because `seq` is an order the authority reassigns while an undo step has
   * to keep naming the same edit (see `EditEntry.id`). An entry with no id can never be excluded,
   * which is the safe direction: it replays, so the project is what the log says.
   */
  readonly excluding?: ReadonlySet<string>;
  /** Replay only entries above this seq - the base snapshot already reflects the rest. */
  readonly above?: number;
  /**
   * Ignore the log's own tombstones and exclude only `excluding`.
   *
   * For a caller that has already computed the exclusion set over a wider window than the entries
   * it is passing - a rebuild replays a tail, but a tombstone in that tail can take back an edit
   * baked into the base beneath it, so the set has to be worked out before the base is even chosen.
   */
  readonly ignoreTombstones?: boolean;
}

/**
 * Apply a stream of entries to a store, in the order given. Mutates; returns nothing.
 *
 * The log's tombstones are honoured by default, so a stream of entries is a complete account of the
 * project: hand it every entry and it applies the edits that still stand. Note it needs the undo and
 * redo entries to do that, so a caller must not filter them out on the way in - they are skipped for
 * *applying* (`isReplayable`), which is a different question from whether they are needed.
 */
export function replayEntries(project: ProjectStore, entries: readonly EditEntry[], options: ReplayOptions = {}): void {
  const { excluding, above, ignoreTombstones } = options;
  const tombstoned = ignoreTombstones ? null : tombstonedIds(entries);
  for (const entry of entries) {
    if (above !== undefined && entry.seq <= above) continue;
    if (!isReplayable(entry.kind)) continue;
    if (entry.id === undefined) {
      applyEdit(project, entry.command as EditCommand, entry.author as Author);
      continue;
    }
    if (excluding?.has(entry.id) || tombstoned?.has(entry.id)) continue;
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
  // `excluding` is the caller's complete set - it already folded in the log's tombstones over the
  // whole log, which is the only way to notice one that takes back an edit below `baseSeq`.
  replayEntries(project, entries, { above: baseSeq, excluding, ignoreTombstones: true });
  return project.snapshot();
}
