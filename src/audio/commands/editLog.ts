/**
 * The authored edit log: the single seam every durable edit flows through.
 * `dispatch(command, author)` records an undo checkpoint, applies the command,
 * and appends an authored, timestamped entry to an append-only log. The log is
 * the keystone artifact (it drives the activity feed now and, next slice, the
 * on-disk file format and history); undo/redo is a consumer built on top.
 *
 * Undo uses whole-project snapshot checkpoints (every store already has
 * snapshot()/load(), and load() rebuilds child stores + re-emits, so the UI and
 * the MCP mirror stay in sync). Rapid edits to the same target (a knob drag,
 * repeated nudges) coalesce into one checkpoint and one log entry.
 *
 * In-memory for this slice; persisting the log is the next step (the entry type
 * is serializable by construction).
 */
import { ProjectStore } from "../project/projectStore";
import type { ProjectData } from "../project/types";
import { applyEdit } from "./applyEdit";
import { describeCommand, type DescribeContext } from "./describe";
import type { Author, EditCommand, EditEntry } from "./types";

/**
 * An undo/redo checkpoint: the project state to restore, plus the command that
 * the checkpoint brackets - so undo/redo can describe what they reverted/reapplied
 * in the activity feed.
 */
export interface Checkpoint {
  snap: ProjectData;
  command: EditCommand;
  author: Author;
}

/** One step in a packed stack: the command a checkpoint brackets. */
interface PackedStep {
  command: EditCommand;
  author: Author;
}

/**
 * A persisted undo/redo stack in *delta* form: one base snapshot plus the command
 * of each checkpoint. Every other checkpoint snapshot is recovered by replaying
 * those commands through `applyEdit` (the same keyframe+delta idea as the commit
 * DAG). The in-memory stacks still hold full snapshots for instant undo - only the
 * persisted form is delta-encoded, turning ~30 snapshots on disk into one.
 */
export interface PackedStack {
  base: ProjectData | null;
  steps: PackedStep[];
}

/** Persisted undo/redo stacks (delta-encoded), so undo survives a reload (DESIGN.md section 7). */
export interface UndoState {
  undo: PackedStack;
  redo: PackedStack;
}

const COALESCE_MS = 400;
const MAX_DEPTH = 100;
/** How many checkpoints to persist per stack (delta-encoded: one base snapshot + commands). */
const PERSIST_UNDO_DEPTH = 30;
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
 * narrated changelog (DESIGN.md section 7).
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
  private undoStack: Checkpoint[] = [];
  private redoStack: Checkpoint[] = [];
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
    this.rebuild();
  }

  /** Apply + log an edit. UI edits are authored by the current user (default 'you'); MCP edits 'claude'. */
  dispatch = (command: EditCommand, author: Author = this.localAuthor): void => {
    const now = Date.now();
    const key = COALESCABLE.has(command.type) ? `${author}:${coalesceKey(command)}` : null;
    const coalesce =
      key !== null && key === this.lastKey && now - this.lastTime < COALESCE_MS && this.entries.length > 0;

    if (coalesce) {
      // Same target as the last edit, within the window: fold into it (one undo
      // step, one log entry) - the pre-edit checkpoint already captures "before".
      applyEdit(this.project, command, author);
      const last = this.entries[this.entries.length - 1];
      this.entries[this.entries.length - 1] = { ...last, command, time: now };
      const top = this.undoStack[this.undoStack.length - 1];
      if (top) top.command = command; // describe the gesture by its latest state
    } else {
      this.undoStack.push({ snap: this.project.snapshot(), command, author });
      if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      applyEdit(this.project, command, author);
      this.entries.push({ seq: this.seq++, command, author, time: now, kind: "edit" });
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
    const cp = this.undoStack.pop();
    if (!cp) return;
    this.redoStack.push({ snap: this.project.snapshot(), command: cp.command, author: cp.author });
    this.project.load(cp.snap);
    // Record the undo in the activity feed (append-only; the feed is a reflog,
    // authored by whoever pressed undo - the local user).
    this.entries.push({
      seq: this.seq++,
      command: cp.command,
      author: this.localAuthor,
      time: Date.now(),
      kind: "undo",
      label: `Undid: ${describeCommand(cp.command)}`,
    });
    this.lastKey = null;
    this.emit();
  };

  redo = (): void => {
    const cp = this.redoStack.pop();
    if (!cp) return;
    this.undoStack.push({ snap: this.project.snapshot(), command: cp.command, author: cp.author });
    this.project.load(cp.snap);
    this.entries.push({
      seq: this.seq++,
      command: cp.command,
      author: this.localAuthor,
      time: Date.now(),
      kind: "redo",
      label: `Redid: ${describeCommand(cp.command)}`,
    });
    this.lastKey = null;
    this.emit();
  };

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

  /** The undo/redo stacks for persistence, bounded then delta-encoded (one base snapshot each). */
  getCheckpoints(): UndoState {
    return {
      undo: packUndo(this.undoStack.slice(-PERSIST_UNDO_DEPTH)),
      redo: packRedo(this.redoStack.slice(-PERSIST_UNDO_DEPTH)),
    };
  }

  /** Restore persisted undo/redo stacks (after restore()), rebuilding snapshots by replay. */
  restoreCheckpoints(state: UndoState | null): void {
    this.undoStack = unpackUndo(state?.undo);
    this.redoStack = unpackRedo(state?.redo);
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

// ---- delta-encoding of the persisted undo/redo stacks ----
//
// A checkpoint's snapshot is the live state at push time, and the live state is
// always `applyEdit(previousCheckpoint.snapshot, previousCheckpoint.command)`. So a
// stack is fully reconstructable from one base snapshot + each checkpoint's command.
// The two stacks chain in opposite directions: an undo checkpoint's snapshot is the
// state *before* its command (chains forward from the bottom), a redo checkpoint's is
// the state *after* its command (chains forward from the top) - hence two encoders.

/** Pack an undo stack: anchor at the bottom snapshot; steps replay forward up it. */
function packUndo(stack: Checkpoint[]): PackedStack {
  if (stack.length === 0) return { base: null, steps: [] };
  return {
    base: stack[0].snap,
    steps: stack.map((checkpoint) => ({ command: checkpoint.command, author: checkpoint.author })),
  };
}

/** Pack a redo stack: anchor at the top snapshot; steps replay forward back down it. */
function packRedo(stack: Checkpoint[]): PackedStack {
  if (stack.length === 0) return { base: null, steps: [] };
  return {
    base: stack[stack.length - 1].snap,
    steps: stack.map((checkpoint) => ({ command: checkpoint.command, author: checkpoint.author })),
  };
}

/** Rebuild an undo stack from packed form (base snapshot + forward-replayed steps). */
function unpackUndo(packed: PackedStack | null | undefined): Checkpoint[] {
  if (!packed?.base) return [];
  const store = new ProjectStore(false);
  store.load(packed.base);
  const checkpoints: Checkpoint[] = [];
  let snapshot: ProjectData = packed.base;
  packed.steps.forEach((step, index) => {
    checkpoints.push({ snap: snapshot, command: step.command, author: step.author });
    if (index < packed.steps.length - 1) {
      applyEdit(store, step.command, step.author); // advance to the next checkpoint's snapshot
      snapshot = store.snapshot();
    }
  });
  return checkpoints;
}

/** Rebuild a redo stack from packed form (top snapshot + steps replayed back down it). */
function unpackRedo(packed: PackedStack | null | undefined): Checkpoint[] {
  if (!packed?.base) return [];
  const count = packed.steps.length;
  const store = new ProjectStore(false);
  store.load(packed.base);
  const checkpoints: Checkpoint[] = new Array(count);
  let snapshot: ProjectData = packed.base;
  checkpoints[count - 1] = {
    snap: snapshot,
    command: packed.steps[count - 1].command,
    author: packed.steps[count - 1].author,
  };
  for (let index = count - 2; index >= 0; index--) {
    applyEdit(store, packed.steps[index].command, packed.steps[index].author); // step one checkpoint earlier
    snapshot = store.snapshot();
    checkpoints[index] = { snap: snapshot, command: packed.steps[index].command, author: packed.steps[index].author };
  }
  return checkpoints;
}
