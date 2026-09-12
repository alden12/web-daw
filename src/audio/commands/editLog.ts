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
import { fingerprintProject } from "../project/fingerprint";
import { ProjectStore } from "../project/projectStore";
import type { ProjectData } from "../project/types";
import { applyEdit } from "./applyEdit";
import { authorshipBefore, invert, restoreAuthorship, type PriorAuthors } from "./invert";
import { describeCommand, type DescribeContext } from "./describe";
import type { Author, EditCommand, EditEntry } from "./types";

/** What every checkpoint carries: the command it brackets, so undo/redo can describe what they
 *  reverted/reapplied in the activity feed, and who authored it. */
interface CheckpointBase {
  command: EditCommand;
  author: Author;
}

/**
 * The original checkpoint: a whole-project snapshot to restore. Instant, never wrong, and
 * expensive - see `MAX_DEPTH`. The fallback for any command type `invert` cannot reverse yet.
 */
export interface SnapshotCheckpoint extends CheckpointBase {
  snap: ProjectData;
}

/**
 * The cheap checkpoint (DAW-34): the commands that reverse `command`, captured before it was
 * applied. Undo applies them in order; redo re-applies `command` itself. Direction-free, so it
 * moves between the undo and redo stacks unchanged.
 */
export interface InverseCheckpoint extends CheckpointBase {
  inverse: EditCommand[];
  /**
   * The authorship the command stamped over. A snapshot restores authorship with everything else,
   * so an inverse has to carry it or undo would re-attribute the object to whoever undid it.
   */
  authors: PriorAuthors;
}

/**
 * A checkpoint is one or the other, so inverse coverage can land command-by-command with the
 * snapshot path carrying whatever is not converted yet (DAW-34). Both stacks hold a mix.
 */
export type Checkpoint = SnapshotCheckpoint | InverseCheckpoint;

export const isSnapshotCheckpoint = (checkpoint: Checkpoint): checkpoint is SnapshotCheckpoint => "snap" in checkpoint;

/** One step in a packed stack: the command a checkpoint brackets, plus its inverse if it had one. */
interface PackedStep {
  command: EditCommand;
  author: Author;
  /** Present for an `InverseCheckpoint`; absent for a snapshot one (whose state is replayed). */
  inverse?: EditCommand[];
  /** The authorship that inverse restores; travels with it. */
  authors?: PriorAuthors;
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

/** Persisted undo/redo stacks (delta-encoded), so undo survives a reload (see apm: "History and versioning"). */
export interface UndoState {
  undo: PackedStack;
  redo: PackedStack;
  /**
   * A fingerprint of the project state these stacks were captured against, so a reload can tell
   * whether they still apply to the project it just restored (DAW-8.15).
   *
   * **A stale stack is far worse than no stack** wherever a checkpoint is still a whole-project
   * snapshot: undoing against one from earlier in the session does not undo the last edit, it
   * throws the project back to that older state and drops everything since. An empty stack merely
   * greys out undo. So the two are compared on load and a mismatch discards, which turns "silently
   * lost my work" into "undo is unavailable". An all-inverse stack will be able to do better than
   * discard (refuse the entries that conflict, keep the rest - DAW-34), which is exactly the
   * per-entry failure a snapshot cannot express.
   *
   * The state, not the log's high-water `seq`, because the two edit-log counters in a hosted
   * session are different numbering spaces: a coalesced gesture is one local entry but many
   * forwarded edits at the authority, so the client's counter runs permanently behind the log it
   * reloads. See `fingerprintProject`.
   */
  state: string;
}

const COALESCE_MS = 400;
/**
 * How many checkpoints each in-memory stack holds. **This is the expensive one** while checkpoints
 * are still snapshots: one holds a full `ProjectData` copy, so the ceiling is roughly this many
 * copies of the project in RAM. It can rise once every command type has an inverse (DAW-34) and a
 * checkpoint costs an old value instead. Deeper history is what the version timeline is for; undo is
 * the recent-gesture buffer.
 */
const MAX_DEPTH = 100;
/**
 * How many checkpoints to persist per stack. Matched to `MAX_DEPTH` deliberately: persisting fewer
 * than we hold silently shortened undo across a reload (30 of your 100 steps), and the persisted
 * form is delta-encoded to one base snapshot plus a command each, so the extra steps are cheap.
 * `PERSIST_UNDO_MAX_BYTES` is what actually bounds the file.
 */
const PERSIST_UNDO_DEPTH = MAX_DEPTH;
/**
 * Byte budget for `undo.json`. The steps are small; the two base snapshots are not, and they scale
 * with the project rather than with anything we cap here - so a big enough project would push the
 * file past the server's 8MB JSON limit, have the write rejected, and lose undo across a reload
 * with no explanation. Over budget we drop the redo stack (which costs one base snapshot and is the
 * less valuable half after a reload), then give up rather than write something that cannot land.
 */
const PERSIST_UNDO_MAX_BYTES = 2_000_000;
/** An absent stack in packed form. */
const EMPTY_STACK: PackedStack = { base: null, steps: [] };
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
      this.undoStack.push(this.checkpoint(command, author));
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
    this.redoStack.push(this.flip(cp));
    this.rewind(cp);
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
    this.undoStack.push(this.flip(cp));
    this.replay(cp);
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

  /**
   * A checkpoint for an about-to-be-applied command. Must be called BEFORE `applyEdit`, while the
   * project still holds the pre-edit state: that is what `invert` reads, and what a snapshot copies.
   * An inverse when we have one, a whole-project snapshot when we do not (DAW-34).
   */
  private checkpoint(command: EditCommand, author: Author): Checkpoint {
    const inverse = invert(this.project, command);
    if (!inverse) return { snap: this.project.snapshot(), command, author };
    // The inverse's own keys count too: restoring a removed effect re-stamps parameters that had no
    // author before the edit, and those have to be cleared again on undo.
    return { inverse, authors: authorshipBefore(this.project, [command, ...inverse]), command, author };
  }

  /**
   * The copy of a checkpoint to push onto the opposite stack. A snapshot checkpoint's `snap` means
   * "the state on the other side of this command", which is the live state right now, so it is
   * re-stamped. An inverse checkpoint is direction-free and crosses over unchanged.
   */
  private flip(checkpoint: Checkpoint): Checkpoint {
    return isSnapshotCheckpoint(checkpoint) ? { ...checkpoint, snap: this.project.snapshot() } : checkpoint;
  }

  /** Move the project back to before `checkpoint.command`: load its snapshot, or apply its inverse. */
  private rewind(checkpoint: Checkpoint): void {
    if (isSnapshotCheckpoint(checkpoint)) {
      this.project.load(checkpoint.snap);
      return;
    }
    for (const command of checkpoint.inverse) applyEdit(this.project, command, checkpoint.author);
    // After, not before: applying the inverse re-stamps the keys it touches, so the captured
    // authorship has to be the last word.
    restoreAuthorship(this.project, checkpoint.authors);
  }

  /** Move the project forward past `checkpoint.command` again: load its snapshot, or re-apply it. */
  private replay(checkpoint: Checkpoint): void {
    if (isSnapshotCheckpoint(checkpoint)) this.project.load(checkpoint.snap);
    else applyEdit(this.project, checkpoint.command, checkpoint.author);
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

  /** The undo/redo stacks for persistence, bounded then delta-encoded (one base snapshot each). */
  getCheckpoints(): UndoState {
    const live = this.project.snapshot();
    const state = fingerprintProject(live);
    const undo = packUndo(this.undoStack.slice(-PERSIST_UNDO_DEPTH), live);
    const redo = packRedo(this.redoStack.slice(-PERSIST_UNDO_DEPTH), live);
    // Both stacks, then undo alone, then neither: see PERSIST_UNDO_MAX_BYTES.
    const candidates: UndoState[] = [
      { undo, redo, state },
      { undo, redo: EMPTY_STACK, state },
    ];
    const affordable = candidates.find((candidate) => withinUndoBudget(candidate));
    if (affordable) return affordable;
    console.warn(
      `[web-daw] undo: this project's snapshot is too large to persist undo state (over ` +
        `${PERSIST_UNDO_MAX_BYTES} bytes). Undo works in this session but will not survive a reload.`,
    );
    return { undo: EMPTY_STACK, redo: EMPTY_STACK, state };
  }

  /**
   * Restore persisted undo/redo stacks, rebuilding snapshots by replay.
   *
   * **Restores only stacks captured against the project state we just loaded** (see
   * `UndoState.state`). Call this after the project has been loaded, never before, or the
   * comparison is against an empty project and every stack is discarded.
   */
  restoreCheckpoints(stored: UndoState | null): void {
    const current = fingerprintProject(this.project.snapshot());
    const matches = stored !== null && stored.state === current;
    // Say so rather than silently greying out undo. "Undo did nothing after a reload" is otherwise
    // indistinguishable from "the stack was never written", and those have opposite fixes.
    if (stored && !matches) {
      console.warn(
        `[web-daw] undo: discarding a stack captured against project state ${stored.state}; this ` +
          `project is at ${current}. Undo is unavailable for this load - applying a stack from a ` +
          "different state would roll the project back rather than undo one edit.",
      );
    }
    const accepted = matches ? stored : null;
    this.undoStack = unpackUndo(accepted?.undo);
    this.redoStack = unpackRedo(accepted?.redo);
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
// A snapshot checkpoint's state is the live state at push time, and the live state is always
// `applyEdit(previousCheckpoint.snapshot, previousCheckpoint.command)`. So a stack of them is fully
// reconstructable from one base snapshot + each checkpoint's command. The two stacks chain in
// opposite directions: an undo checkpoint's snapshot is the state *before* its command (chains
// forward from the bottom), a redo checkpoint's is the state *after* its command (chains forward
// from the top) - hence two encoders.
//
// An inverse checkpoint (DAW-34) needs none of that: its inverse commands ARE the persisted form, so
// it stores itself. A stack is a mix during the migration, and the base snapshot it still needs
// shrinks out of existence on its own once every command type has an inverse - at which point this
// whole section goes away with `undo.json`.

/** The step form of a checkpoint: its command, plus its inverse when it had one. */
const packStep = (checkpoint: Checkpoint): PackedStep =>
  isSnapshotCheckpoint(checkpoint)
    ? { command: checkpoint.command, author: checkpoint.author }
    : {
        command: checkpoint.command,
        author: checkpoint.author,
        inverse: checkpoint.inverse,
        authors: checkpoint.authors,
      };

/** Does this stack still contain a checkpoint whose state has to be replayed from a base snapshot? */
const needsBase = (stack: Checkpoint[]): boolean => stack.some(isSnapshotCheckpoint);

/**
 * The project state at the bottom of an undo stack, walked down from the live state: a snapshot
 * checkpoint's own `snap` where there is one, applying the inverse where there is not. Reduces to
 * `stack[0].snap` for an all-snapshot stack (the pre-DAW-34 case), and is never called for an
 * all-inverse one.
 */
function undoBase(stack: Checkpoint[], live: ProjectData): ProjectData {
  const store = new ProjectStore(false);
  store.load(live);
  for (let index = stack.length - 1; index >= 0; index--) {
    const checkpoint = stack[index];
    if (isSnapshotCheckpoint(checkpoint)) store.load(checkpoint.snap);
    else for (const command of checkpoint.inverse) applyEdit(store, command, checkpoint.author);
  }
  return store.snapshot();
}

/**
 * The project state at the top of a redo stack: the state *after* the next-to-be-redone command.
 * The live project sits immediately before it, so one forward apply gets there.
 */
function redoBase(stack: Checkpoint[], live: ProjectData): ProjectData {
  const top = stack[stack.length - 1];
  if (isSnapshotCheckpoint(top)) return top.snap;
  const store = new ProjectStore(false);
  store.load(live);
  applyEdit(store, top.command, top.author);
  return store.snapshot();
}

/** Pack an undo stack: anchor at the bottom state; steps replay forward up it. */
function packUndo(stack: Checkpoint[], live: ProjectData): PackedStack {
  if (stack.length === 0) return EMPTY_STACK;
  return { base: needsBase(stack) ? undoBase(stack, live) : null, steps: stack.map(packStep) };
}

/** Pack a redo stack: anchor at the top state; steps replay forward back down it. */
function packRedo(stack: Checkpoint[], live: ProjectData): PackedStack {
  if (stack.length === 0) return EMPTY_STACK;
  return { base: needsBase(stack) ? redoBase(stack, live) : null, steps: stack.map(packStep) };
}

/**
 * Does this packed state fit the persistence budget? Measured on the serialized length rather than
 * true UTF-8 bytes: the payload is ids, numbers and enum strings apart from user-entered names, so
 * the two agree to well inside the margin a budget like this needs.
 */
const withinUndoBudget = (state: UndoState): boolean => JSON.stringify(state).length <= PERSIST_UNDO_MAX_BYTES;

/** Rebuild an undo stack from packed form (base snapshot + forward-replayed steps). */
function unpackUndo(packed: PackedStack | null | undefined): Checkpoint[] {
  const steps = packed?.steps ?? [];
  const base = packed?.base ?? null;
  if (steps.length === 0) return [];
  const store = base ? new ProjectStore(false) : null;
  if (store && base) store.load(base);
  let snapshot: ProjectData | null = base;
  const checkpoints: Checkpoint[] = [];
  for (const [index, step] of steps.entries()) {
    if (step.inverse)
      checkpoints.push({
        inverse: step.inverse,
        authors: step.authors ?? {},
        command: step.command,
        author: step.author,
      });
    else if (snapshot) checkpoints.push({ snap: snapshot, command: step.command, author: step.author });
    // A snapshot step with no base to replay from: our own packer never writes that, so this is a
    // hand-edited or truncated file. Drop the stack rather than restore a half of it.
    else return [];
    if (store && index < steps.length - 1) {
      applyEdit(store, step.command, step.author); // advance to the next checkpoint's snapshot
      snapshot = store.snapshot();
    }
  }
  return checkpoints;
}

/** Rebuild a redo stack from packed form (top snapshot + steps replayed back down it). */
function unpackRedo(packed: PackedStack | null | undefined): Checkpoint[] {
  const steps = packed?.steps ?? [];
  const base = packed?.base ?? null;
  if (steps.length === 0) return [];
  const store = base ? new ProjectStore(false) : null;
  if (store && base) store.load(base);
  let snapshot: ProjectData | null = base;
  const checkpoints: Checkpoint[] = new Array(steps.length);
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (store && index < steps.length - 1) {
      applyEdit(store, step.command, step.author); // step one checkpoint earlier
      snapshot = store.snapshot();
    }
    if (step.inverse)
      checkpoints[index] = {
        inverse: step.inverse,
        authors: step.authors ?? {},
        command: step.command,
        author: step.author,
      };
    else if (snapshot) checkpoints[index] = { snap: snapshot, command: step.command, author: step.author };
    else return [];
  }
  return checkpoints;
}
