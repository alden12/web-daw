/**
 * Reconnect conflict detection: after an offline stint, decide whether this client's held edits clash
 * with the edits a peer made in the meantime. "Clash" is decided at LEAF granularity - the same note,
 * param, effect, clip, placement, or project facet - so two people working on different parts of the
 * same track do NOT conflict, but two people moving the same note do.
 *
 * The leaf keys reuse `authorshipEffect` (the same key spellings the last-editor tint uses). A command
 * also stamps its enclosing `track:`/`group:` container for the tint; we drop that here (unless the
 * command's real target IS the container - create/remove/rename/move) so same-track-but-different-thing
 * edits don't look like conflicts. Project-level commands (tempo, groove, loop) get a distinct
 * `project:<facet>` key so two peers changing the same facet clash but tempo-vs-loop doesn't.
 */
import { authorshipEffect } from "../commands/authorship";
import type { Author, EditCommand } from "../commands/types";

/** Commands whose real edit target is the track/group itself (not a leaf inside it), so the container
 *  key is the conflict key rather than noise to strip. */
const CONTAINER_TARGETS = new Set<EditCommand["type"]>([
  "createTrack",
  "createTrackFromPatch",
  "createAudioTrack",
  "addAudioTrack",
  "removeTrack",
  "setTrack",
  "moveTrack",
  "setInstrument",
  "applyPatch",
  "createGroup",
  "removeGroup",
  "setGroup",
  "moveGroup",
]);

/** Project-wide commands, each keyed by the facet it changes (so same-facet edits clash, cross-facet don't). */
const PROJECT_KEYS: Partial<Record<EditCommand["type"], string>> = {
  renameProject: "project:name",
  setTempo: "project:tempo",
  setGroove: "project:groove",
  setLength: "project:length",
  setLoopStart: "project:loopStart",
};

const unique = (keys: string[]): string[] => [...new Set(keys)];

/** The leaf keys a command targets, for conflict comparison (see the module note). */
export function conflictKeys(command: EditCommand): string[] {
  const projectKey = PROJECT_KEYS[command.type];
  if (projectKey) return [projectKey];
  const effect = authorshipEffect(command);
  const keys = [...(effect.touched ?? []), ...(effect.removed ?? [])];
  if (CONTAINER_TARGETS.has(command.type)) return unique(keys);
  // Drop the enclosing container stamp; keep only the finer keys (note/param/effect/clip/placement).
  return unique(keys.filter((key) => !key.startsWith("track:") && !key.startsWith("group:")));
}

/** A key ending in ":" is a prefix that clears everything under it (e.g. `param:t1:` on removeTrack). */
const isPrefixKey = (key: string): boolean => key.endsWith(":");

const pairConflicts = (a: string, b: string): boolean =>
  a === b || (isPrefixKey(a) && b.startsWith(a)) || (isPrefixKey(b) && a.startsWith(b));

/** Whether any key in `a` targets the same object as any key in `b` (exact or prefix overlap). */
export function keysOverlap(a: string[], b: string[]): boolean {
  return a.some((keyA) => b.some((keyB) => pairConflicts(keyA, keyB)));
}

/** One side of a conflict, ready to render: a human phrase and who authored it. */
export interface ConflictEntry {
  text: string;
  author: Author;
}

/** The conflicting edits on each side, for the reconnect dialog. */
export interface ConflictInfo {
  theirs: ConflictEntry[];
  mine: ConflictEntry[];
}

/** An authored command, either a peer's missed edit or one of this client's held ops. */
export interface AuthoredCommand {
  command: EditCommand;
  author: Author;
}

/** Keep the last entry per description (a 30-op note drag collapses to one "Moved note" line). */
function dedupeByText(entries: ConflictEntry[]): ConflictEntry[] {
  const byText = new Map<string, ConflictEntry>();
  for (const entry of entries) byText.set(entry.text, entry);
  return [...byText.values()];
}

/**
 * Detect a conflict between a peer's missed edits and this client's held edits. Returns the conflicting
 * edits on each side (deduped, described), or null if they touch disjoint objects. `describe` turns a
 * command into a human phrase (the caller passes `describeCommand` with a name-resolving context).
 */
export function detectConflict(
  peerEdits: AuthoredCommand[],
  mine: AuthoredCommand[],
  describe: (command: EditCommand) => string,
): ConflictInfo | null {
  if (peerEdits.length === 0 || mine.length === 0) return null;
  const mineKeys = mine.flatMap((op) => conflictKeys(op.command));
  const peerConflicting = peerEdits.filter((edit) => keysOverlap(conflictKeys(edit.command), mineKeys));
  if (peerConflicting.length === 0) return null;
  const peerKeys = peerEdits.flatMap((edit) => conflictKeys(edit.command));
  const mineConflicting = mine.filter((op) => keysOverlap(conflictKeys(op.command), peerKeys));
  return {
    theirs: dedupeByText(peerConflicting.map((edit) => ({ text: describe(edit.command), author: edit.author }))),
    mine: dedupeByText(mineConflicting.map((op) => ({ text: describe(op.command), author: op.author }))),
  };
}
