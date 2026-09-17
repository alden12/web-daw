/**
 * The authored edit log: the single seam every durable edit flows through.
 * `dispatch(command, author)` records an undo checkpoint, applies the command,
 * and appends an authored, timestamped entry to an append-only log. The log is
 * the keystone artifact (it drives the activity feed now and, next slice, the
 * on-disk file format and history); undo/redo is a consumer built on top.
 *
 * A checkpoint is either a command's *inverse* (cheap, and the direction DAW-34 is taking undo) or a
 * whole-project snapshot, for the command types `invert` cannot reverse yet. Snapshots work because
 * every store has snapshot()/load(), and load() rebuilds child stores + re-emits, so the UI and the
 * MCP mirror stay in sync; they are simply large. Coverage lands command-by-command and both stacks
 * hold a mix meanwhile. Rapid edits to the same target (a knob drag, repeated nudges) coalesce into
 * one checkpoint and one log entry.
 *
 * In-memory for this slice; persisting the log is the next step (the entry type
 * is serializable by construction).
 */
import type { ProjectStore } from "../project/projectStore";
import type { ProjectData } from "../project/types";
import { applyEdit } from "./applyEdit";
import { normalizeCommand } from "./normalize";
import { isReplayable, rebuildWithout } from "./replay";
import { describeCommand, type DescribeContext } from "./describe";
import type { Author, EditCommand, EditEntry } from "./types";

/**
 * An undo step is the `seq` of the log entry it takes back, and nothing else (DAW-34).
 *
 * Undo rebuilds the project from a retained keyframe with the excluded seqs left out, so a step has
 * only to name an edit: no snapshot to hold, no inverse to compute, no authorship to capture and
 * put back. The command and its author are read out of the log when the feed wants to describe what
 * was undone, rather than copied into the step and kept in sync.
 */

/**
 * Persisted undo/redo stacks, so undo survives a reload (see apm: "History and versioning").
 *
 * Two lists of `seq`, which is the whole file. It used to carry a base snapshot plus a command and
 * an inverse per step, which is why it needed a byte budget and a fingerprint of the project it was
 * captured against: a checkpoint held a whole-project state, so applying a stale one threw the
 * project back to that state instead of taking back one edit (DAW-8.15).
 *
 * **That failure is now impossible, so the guard is gone.** A step names a log entry; if the entry
 * is not there, excluding it changes nothing and the undo is a no-op. `restoreCheckpoints` drops
 * seqs the log does not have and keeps the rest, which is the per-entry answer the fingerprint's
 * all-or-nothing discard could never give.
 */
export interface UndoState {
  /** Seqs that can still be taken back, oldest first. */
  undo: number[];
  /** Seqs taken back and not yet re-applied, in the order they were undone. */
  redo: number[];
}

const COALESCE_MS = 400;
/**
 * How many steps each in-memory stack holds. A step is now a number, so this costs nothing to hold
 * and the real ceiling is elsewhere: undo can only reach back as far as the retained keyframe ring
 * (DAW-34 stage B), and past that a rebuild has no base and the step is refused. Deeper history is
 * what the version timeline is for; undo is the recent-gesture buffer.
 */
const MAX_DEPTH = 500;
const COALESCABLE = new Set<EditCommand["type"]>([
  "setParam",
  "setEffectParam",
  "setTrack",
  "setGroup",
  "setAudioClip",
  "setTempo",
  "setTimeSignature",
  "setGroove",
  "setLength",
  "setLoopStart",
  "editNotes",
  "setClipLength",
  "movePlacement",
  "resizePlacement",
]);

/** Identity of a command's edit target, so successive edits to it can coalesce. */
function coalesceKey(command: EditCommand): string {
  switch (command.type) {
    case "setParam":
      return `setParam:${command.trackId}:${command.id}`;
    case "setEffectParam":
      return `setEffectParam:${command.hostId}:${command.effectId}:${command.id}`;
    case "setTrack":
      return `setTrack:${command.trackId}`;
    case "setGroup":
      return `setGroup:${command.groupId}`;
    case "setAudioClip":
      return `setAudioClip:${command.trackId}`;
    case "setTempo":
      return "setTempo";
    case "setTimeSignature":
      return "setTimeSignature";
    case "setGroove":
      // Coalesce by which facet is changing, so amount drags collapse but a template
      // pick stays its own entry.
      return command.grooveId !== undefined ? "setGroove:id" : "setGroove:amount";
    case "setLength":
      return "setLength";
    case "setLoopStart":
      return "setLoopStart";
    case "setClipLength":
      return `setClipLength:${command.trackId}:${command.clipId ?? ""}`;
    case "movePlacement":
      return `movePlacement:${command.trackId}:${command.placementId}`;
    case "resizePlacement":
      return `resizePlacement:${command.trackId}:${command.placementId}`;
    // Coalesce a continuous drag of a stable selection into one entry; a new
    // gesture (different note set) gets a fresh key, so it starts a new edit.
    case "editNotes":
      return `editNotes:${command.trackId}:${command.clipId ?? ""}:${command.notes
        .map((note) => note.id)
        .sort()
        .join(",")}`;
    default:
      return command.type;
  }
}

/**
 * A feed-only annotation - a line of intent narration (e.g. Claude saying what it
 * is doing), shown in the activity feed but NOT an edit: it changes no project
 * state, so it stays out of the *replayable* edit stream (materialize/applyEdit
 * never touch it). Shares the edit `seq` counter so it interleaves with edits in
 * feed order. Persisted as a parallel stream (notes.json) and swept into each
 * commit, so the narration survives a reload and the version timeline reads as a
 * narrated changelog (see apm: "History and versioning").
 */
export interface FeedNote {
  seq: number;
  text: string;
  author: Author;
  time: number;
}

export interface EditLogState {
  entries: EditEntry[];
  notes: FeedNote[];
  canUndo: boolean;
  canRedo: boolean;
}

export class EditLog {
  private readonly project: ProjectStore;
  private entries: EditEntry[] = [];
  private feedNotes: FeedNote[] = [];
  /** Seqs that can be taken back (most recent last), and seqs taken back and re-appliable. */
  private undoStack: number[] = [];
  private redoStack: number[] = [];
  /** Seqs currently left out of the project. The live project is always the base replayed with
   *  these excluded, which is what makes undo a rebuild rather than a reversal. */
  private undone = new Set<number>();
  /** The snapshot a rebuild starts from, and the seq it reflects. Seeded to wherever the project is
   *  when the log is built, and replaced by `setRebuildBase` with an older retained keyframe once
   *  persistence has one - which is what makes edits from before a reload undoable. */
  private base: { project: ProjectData; seq: number };
  private seq = 0;
  /** The author stamped on local edits/undo/redo when a caller doesn't specify one (MCP passes "claude",
   *  the agent "agent"). Defaults to "you"; a shared session sets it to the current user id. */
  private localAuthor: Author = "you";
  private lastKey: string | null = null;
  private lastTime = 0;
  private readonly listeners = new Set<() => void>();
  private cached!: EditLogState;
  /** Optional realtime sink: when a shared session is live, each dispatched edit is forwarded to the
   *  authority after being applied optimistically here (see SharedSession). Undo/redo do NOT forward -
   *  they are local best-effort in a shared session. */
  private remote: ((command: EditCommand, author: Author) => void) | null = null;

  constructor(project: ProjectStore) {
    this.project = project;
    this.base = { project: project.snapshot(), seq: -1 };
    this.rebuild();
  }

  /**
   * Point rebuilds at an older base: a retained keyframe and the seq it reflects (DAW-34 stage B).
   *
   * Undo can reach back exactly as far as this, so persistence hands over the OLDEST keyframe the
   * ring still holds. Without it the base is wherever the project stood when the log was built, and
   * only edits made since are undoable - which is the right answer for a fresh project and the
   * wrong one after a reload.
   */
  setRebuildBase = (project: ProjectData, seq: number): void => {
    this.base = { project, seq };
    this.dropUnreachable();
    this.emit();
  };

  /**
   * Forget steps the base cannot reach. An edit at or below the base is baked into it, so excluding
   * it changes nothing - keeping such a step would leave undo enabled and then do nothing when
   * pressed, which is the one outcome worse than a greyed-out button.
   */
  private dropUnreachable(): void {
    const reachable = (seqs: number[]) => seqs.filter((seq) => seq > this.base.seq);
    this.undoStack = reachable(this.undoStack);
    this.redoStack = reachable(this.redoStack);
    this.undone = new Set([...this.undone].filter((seq) => seq > this.base.seq));
  }

  /** Apply + log an edit. UI edits are authored by the current user (default 'you'); MCP edits 'claude'. */
  dispatch = (raw: EditCommand, author: Author = this.localAuthor): void => {
    // Resolve ambient defaults first (DAW-36), so the checkpoint, the apply, the log entry and the
    // forward to the authority all see one self-contained command rather than four chances to
    // resolve "the active clip" against four different states.
    const command = normalizeCommand(this.project, raw);
    const now = Date.now();
    const key = COALESCABLE.has(command.type) ? `${author}:${coalesceKey(command)}` : null;
    const coalesce =
      key !== null && key === this.lastKey && now - this.lastTime < COALESCE_MS && this.entries.length > 0;

    if (coalesce) {
      // Same target as the last edit, within the window: fold into it (one undo
      // step, one log entry) - the pre-edit checkpoint already captures "before".
      applyEdit(this.project, command, author);
      const last = this.entries[this.entries.length - 1];
      // The gesture keeps its seq, so the undo step already points at it and needs no updating.
      this.entries[this.entries.length - 1] = { ...last, command, time: now };
    } else {
      const seq = this.seq++;
      this.undoStack.push(seq);
      if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      applyEdit(this.project, command, author);
      this.entries.push({ seq, command, author, time: now, kind: "edit" });
    }
    this.lastKey = key;
    this.lastTime = now;
    this.remote?.(command, author);
    this.emit();
  };

  /** Set (or clear with null) the realtime sink that forwards each dispatched edit to the authority. */
  setRemote = (sink: ((command: EditCommand, author: Author) => void) | null): void => {
    this.remote = sink;
  };

  /** Set the author stamped on local edits (the current user id in a shared session). */
  setLocalAuthor = (author: Author): void => {
    this.localAuthor = author;
  };

  /**
   * Record a remote peer's edit in the activity feed WITHOUT applying it (the SharedSession has already
   * applied it to the project). Append-only, like a reflog entry, so the feed narrates who-did-what
   * across users. Gets a fresh local `seq` (the feed's own ordering); the caller (SharedSession) already
   * dedups each authoritative edit once, so no seq-space mixing here.
   */
  recordRemote = (command: EditCommand, author: Author): void => {
    this.entries.push({ seq: this.seq++, command, author, time: Date.now(), kind: "edit" });
    this.emit();
  };

  undo = (): void => {
    const seq = this.undoStack.pop();
    if (seq === undefined) return;
    this.redoStack.push(seq);
    this.undone.add(seq);
    this.rebuildProject();
    this.noteReflog(seq, "undo");
  };

  redo = (): void => {
    const seq = this.redoStack.pop();
    if (seq === undefined) return;
    this.undoStack.push(seq);
    this.undone.delete(seq);
    this.rebuildProject();
    this.noteReflog(seq, "redo");
  };

  /**
   * The project as the log says it should be: the base keyframe, with every entry above it replayed
   * except the undone ones (DAW-34 stage C).
   *
   * Authorship comes back for free, because the stamps are re-derived by the same `applyEdit` calls
   * that made them the first time. The inverse path had to capture and restore them by hand, and
   * that hand-written capture was wrong twice before it was right.
   */
  private rebuildProject(): void {
    this.project.load(rebuildWithout(this.base.project, this.base.seq, this.entries, this.undone));
  }

  /** Record an undo/redo in the activity feed: append-only, like a reflog, authored by whoever
   *  pressed it rather than by whoever made the edit. */
  private noteReflog(seq: number, kind: "undo" | "redo"): void {
    const command = this.entries.find((entry) => entry.seq === seq)?.command;
    this.entries.push({
      seq: this.seq++,
      command: command ?? ({ type: "commit" } as EditCommand),
      author: this.localAuthor,
      time: Date.now(),
      kind,
      label: `${kind === "undo" ? "Undid" : "Redid"}: ${command ? describeCommand(command) : "an edit"}`,
    });
    this.lastKey = null;
    this.emit();
  }

  /** Break the coalesce chain so the next edit starts a fresh entry. Called at a
   *  boundary (e.g. after a commit) so post-commit edits never fold into a
   *  committed entry and slip past "uncommitted" tracking. */
  resetCoalescing = (): void => {
    this.lastKey = null;
  };

  /** Post a feed-only annotation (intent narration). Not an edit; not undoable. */
  note = (text: string, author: Author = "claude"): void => {
    this.feedNotes.push({ seq: this.seq++, text, author, time: Date.now() });
    this.emit();
  };

  /** Human-readable label for an entry, resolving ids to current names via the project. */
  describe(entry: EditEntry): string {
    return entry.label ?? describeCommand(entry.command, this.describeContext);
  }

  /** Resolve a track/group id to its current display name (for the feed labels). */
  private readonly describeContext: DescribeContext = {
    name: (id) => this.project.getTrack(id)?.name ?? this.project.getGroup(id)?.name,
  };

  getState(): EditLogState {
    return this.cached;
  }

  /** Feed-only annotations, oldest first. */
  getNotes(): FeedNote[] {
    return this.feedNotes;
  }

  /** The raw append-only entries (for persistence). */
  getEntries(): EditEntry[] {
    return this.entries;
  }

  /** The undo/redo stacks for persistence: two lists of seqs. */
  getCheckpoints(): UndoState {
    return { undo: this.undoStack.slice(), redo: this.redoStack.slice() };
  }

  /**
   * Restore persisted undo/redo stacks.
   *
   * **Per entry, not all-or-nothing.** A seq the restored log does not have as a replayable edit is
   * dropped and the rest are kept, because a step that names a missing entry cannot do harm - a
   * rebuild that excludes nothing produces the project unchanged. That is what replaced DAW-8.15's
   * fingerprint-and-discard, which had to throw away a whole working stack to avoid one that could
   * have rolled the project back.
   *
   * Call it after the project and the log have been restored, or every seq looks unknown.
   */
  restoreCheckpoints(stored: UndoState | null): void {
    const known = new Set(this.entries.filter((entry) => isReplayable(entry.kind)).map((entry) => entry.seq));
    const keep = (seqs: number[] | undefined) => (seqs ?? []).filter((seq) => known.has(seq));
    this.undoStack = keep(stored?.undo);
    this.redoStack = keep(stored?.redo);
    // A redo step is an edit currently left OUT of the project, so the excluded set is the redo
    // stack. The project was loaded from storage already reflecting that, so nothing is rebuilt.
    this.undone = new Set(this.redoStack);
    this.dropUnreachable();
    this.emit();
  }

  /**
   * Replace the log + feed notes with their persisted forms (on reload). Continues
   * `seq` from the highest restored seq across *both* streams, so new edits and
   * notes stay monotonic (correct even if older items were trimmed). Clears the
   * checkpoint stacks; persisted undo/redo is layered back on afterwards via
   * restoreCheckpoints().
   */
  restore(entries: EditEntry[], notes: FeedNote[] = []): void {
    this.entries = entries.slice();
    this.feedNotes = notes.slice();
    const maxEntry = entries.reduce((max, entry) => Math.max(max, entry.seq + 1), 0);
    this.seq = notes.reduce((max, note) => Math.max(max, note.seq + 1), maxEntry);
    this.undoStack = [];
    this.redoStack = [];
    this.undone = new Set();
    // Everything restored is already reflected in the project, so that is the base until
    // `setRebuildBase` offers an older keyframe to reach further back from.
    this.base = { project: this.project.snapshot(), seq: this.seq - 1 };
    this.lastKey = null;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private rebuild(): void {
    this.cached = {
      entries: this.entries.slice(),
      notes: this.feedNotes.slice(),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  private emit(): void {
    this.rebuild();
    for (const listener of this.listeners) listener();
  }
}
