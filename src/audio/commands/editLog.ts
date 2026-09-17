/**
 * The authored edit log: the single seam every durable edit flows through.
 * `dispatch(command, author)` records an undo checkpoint, applies the command,
 * and appends an authored, timestamped entry to an append-only log. The log is
 * the keystone artifact (it drives the activity feed, the on-disk file format and history);
 * undo/redo is a consumer built on top.
 *
 * An undo step is the `seq` of the entry it takes back, and undo is a rebuild of the project with
 * that seq left out (DAW-34 stage C). There are no inverses and no snapshot checkpoints: a step
 * holds no state, so nothing about it can go stale.
 *
 * Successive edits to the same target (a knob drag, repeated nudges) coalesce into one checkpoint,
 * one log entry, and one edit forwarded to the authority. A drag says where it starts and ends
 * (`beginGesture`/`endGesture`), which is what bounds the run; a 400ms window stands in for
 * anything that does not say (DAW-8.13).
 */
import type { ProjectStore } from "../project/projectStore";
import type { ProjectData } from "../project/types";
import { applyEdit } from "./applyEdit";
import { normalizeCommand } from "./normalize";
import { isReplayable, rebuildWithout, tombstonedIds } from "./replay";
import { describeCommand, type DescribeContext } from "./describe";
import type { Author, EditCommand, EditEntry } from "./types";
import { randomUuid } from "../randomUuid";

/**
 * An undo step is the `id` of the log entry it takes back, and nothing else (DAW-34).
 *
 * Undo rebuilds the project from a retained keyframe with the excluded entries left out, so a step
 * has only to name an edit: no snapshot to hold, no inverse to compute, no authorship to capture
 * and put back. The command and its author are read out of the log when the feed wants to describe
 * what was undone, rather than copied into the step and kept in sync.
 *
 * It names the entry's `id`, not its `seq`, because `seq` is an order rather than an identity: the
 * authority assigns it and reassigns it, so a step written against a client seq means nothing once
 * the log comes back renumbered (DAW-34 stage E).
 */

/**
 * Persisted undo/redo stacks, so undo survives a reload (see apm: "History and versioning").
 *
 * Two lists of entry *ids*, which is the whole file. It used to carry a base snapshot plus a command
 * and an inverse per step, which is why it needed a byte budget and a fingerprint of the project it
 * was captured against: a checkpoint held a whole-project state, so applying a stale one threw the
 * project back to that state instead of taking back one edit (DAW-8.15).
 *
 * **That failure is now impossible, so the guard is gone.** A step names a log entry; if the entry
 * is not there, excluding it changes nothing and the undo is a no-op. `restoreCheckpoints` drops
 * ids the log does not have and keeps the rest, which is the per-entry answer the fingerprint's
 * all-or-nothing discard could never give.
 *
 * **Ids rather than seqs (DAW-34 stage E).** A hosted session's entries are renumbered by the
 * authority, so a stack written against client seqs named nothing after a reload and the whole
 * stack was dropped. An id is minted by whoever made the edit and never changes, so the same file
 * means the same thing in both persistence modes.
 */
export interface UndoState {
  /** Entry ids that can still be taken back, oldest first. */
  undo: string[];
  /** Entry ids taken back and not yet re-applied, in the order they were undone. */
  redo: string[];
}

/** How long two edits to the same target may be apart and still fold into one entry, when nothing
 *  has told us where the gesture boundaries are. A drag that says so is not subject to it. */
const COALESCE_MS = 400;
/**
 * A backstop for a gesture that stops sending edits without ever ending - a pointerup lost to a
 * cancelled touch, an exception in a move handler. Well past any drag's frame interval, so a live
 * drag never trips it and only a stuck one does.
 */
const GESTURE_IDLE_MS = 5000;
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

/**
 * One edit on its way to the authority (DAW-34 stage E).
 *
 * `id` is the log entry's own id, which the session sends as the edit's `opId` - one identity for
 * the edit from here to the authority's stored log and on to every peer.
 *
 * With `kind` set it is a TOMBSTONE rather than an edit: `undoes` names the entry it takes back or
 * puts back, and `command` is the command of THAT entry, carried only so the feed can say what was
 * undone. Nothing applies it forward.
 */
export interface ForwardedEdit {
  command: EditCommand;
  author: Author;
  id: string;
  kind?: "undo" | "redo";
  undoes?: string;
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
  /** Entry ids that can be taken back (most recent last), and ids taken back and re-appliable. */
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Entry ids currently left out of the project. The live project is always the base replayed with
   *  these excluded, which is what makes undo a rebuild rather than a reversal. */
  private undone = new Set<string>();
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
  /**
   * Whether a drag is open (DAW-8.13). While one is, successive edits to the same target fold into
   * one entry however long the drag takes, and the forward to the authority waits for it to end.
   * Opened and closed by the pointer-drag layer, which is the only thing that knows a drag's extent.
   */
  private gestureOpen = false;
  /** The settled command of the entry not yet forwarded, and the timer that sends it if no gesture
   *  end arrives. One entry, one authoritative edit - see `forward`. */
  private heldForward: { command: EditCommand; author: Author; id: string } | null = null;
  private forwardTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private cached!: EditLogState;
  /** Optional realtime sink: when a shared session is live, each dispatched edit is forwarded to the
   *  authority after being applied optimistically here (see SharedSession). It is handed the entry's
   *  `id` as well, which the session sends as the edit's `opId` - so the authority stores the same
   *  identity this log holds and an undo step means the same edit on every machine (DAW-34 stage E).
   *  Undo/redo do NOT forward - they are local best-effort in a shared session. */
  private remote: ((edit: ForwardedEdit) => void) | null = null;

  /**
   * Mints an entry's `id`. Injectable so a test can read the log back without a uuid in the
   * assertion; defaults to `crypto.randomUUID` via `randomUuid`.
   *
   * It must be globally unique, not merely unique in this log: in a shared session this id becomes
   * the edit's identity at the authority and on every peer, so two clients minting the same one
   * would have them naming each other's edits.
   */
  private readonly newEntryId: () => string;

  constructor(project: ProjectStore, newEntryId: () => string = randomUuid) {
    this.project = project;
    this.newEntryId = newEntryId;
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
    // A step names an id, so "above the base" is a question about the entry it names. One pass to
    // index the log, because this runs on a reload with a full window of entries and a stack up to
    // MAX_DEPTH deep, and a scan per step would be the product of the two.
    const seqById = new Map(
      this.entries.filter((entry) => entry.id !== undefined).map((entry) => [entry.id, entry.seq]),
    );
    // An id with no entry is unreachable by the same argument: nothing to exclude, nothing to undo.
    const above = (id: string) => (seqById.get(id) ?? -Infinity) > this.base.seq;
    this.undoStack = this.undoStack.filter(above);
    this.redoStack = this.redoStack.filter(above);
    this.undone = new Set([...this.undone].filter(above));
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
      key !== null &&
      key === this.lastKey &&
      this.entries.length > 0 &&
      // A gesture is bounded by its own start and end, so elapsed time says nothing about whether
      // this edit belongs to it: a finger resting on a resize handle mid-drag used to cross the
      // window and start a fresh entry, which is DAW-8.13. Outside a gesture the window is all we
      // have to go on.
      (this.gestureOpen || now - this.lastTime < COALESCE_MS);

    let id: string;
    if (coalesce) {
      // Same target, same gesture (or same window): fold into the last entry, so the drag is one
      // undo step and one log entry.
      applyEdit(this.project, command, author);
      const last = this.entries[this.entries.length - 1];
      // The gesture keeps its id, so the undo step already points at it and needs no updating. A
      // restored entry has none, but cannot be folded into either: `restore` clears `lastKey`.
      id = last.id ?? this.newEntryId();
      this.entries[this.entries.length - 1] = { ...last, id, command, time: now };
    } else {
      id = this.newEntryId();
      this.undoStack.push(id);
      if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift();
      this.redoStack = [];
      applyEdit(this.project, command, author);
      this.entries.push({ seq: this.seq++, id, command, author, time: now, kind: "edit" });
    }
    this.lastKey = key;
    this.lastTime = now;
    this.forward(command, author, key, coalesce, id);
    this.emit();
  };

  /**
   * Open a gesture: every edit until `endGesture` is one drag (DAW-8.13).
   *
   * Two things follow. Edits to the same target fold into one entry regardless of how long the drag
   * takes, so a slow ten-second trim is one undo step and one feed row rather than a dozen. And the
   * forward to the authority is held until the drag ends, so it is one authoritative edit rather
   * than one per frame.
   */
  beginGesture = (): void => {
    this.endGesture(); // an unclosed gesture must not swallow the next drag
    this.gestureOpen = true;
    // A new gesture never folds into the last one, however fast it follows.
    this.lastKey = null;
  };

  /** Close the open gesture, if any, and send what it settled on. */
  endGesture = (): void => {
    if (!this.gestureOpen) return;
    this.gestureOpen = false;
    this.lastKey = null;
    this.sendHeld();
  };

  /**
   * Forward one edit to the authority: once per log entry, carrying what that entry settled on
   * (DAW-8.13).
   *
   * It used to fire on every dispatch, so a two-second knob drag was one local entry and ~120
   * authoritative rows. That flooded the `edits` table, put the client's seq space (which counts
   * entries) out of step with the authority's (which counted frames), and sent every peer a message
   * per frame for information nobody needs at that resolution. Holding the forward until the entry
   * stops changing sends the same information in one row.
   *
   * The live local project still updates every frame - that is what makes the roll and the
   * arrangement redraw together. This is only about what crosses the wire.
   */
  private forward(command: EditCommand, author: Author, key: string | null, coalesced: boolean, id: string): void {
    // A fresh entry settles the one before it, and a non-coalescable edit settles immediately, so
    // sending the held one first is what keeps the authority's order the same as the log's.
    if (!coalesced) this.sendHeld();
    if (key === null) {
      this.remote?.({ command, author, id });
      return;
    }
    this.heldForward = { command, author, id };
    this.armForward();
  }

  /**
   * Send the held forward, if there is one, and start a fresh entry after it.
   *
   * Public because the shared session needs it: its pending queue is what the live project is
   * rebuilt from when a peer's edit arrives, so a held edit has to reach the queue before any
   * rebuild or the drag in progress would be rebuilt away.
   *
   * **It breaks the coalesce chain, which is not incidental.** The edit is forwarded under its
   * entry's id, and the authority dedups by that id, so a further edit folded into the same entry
   * would be sent under an id already applied and silently dropped. Ending the entry here keeps one
   * entry to one authoritative row, at the cost of a drag interrupted this way becoming two of each.
   */
  flushForward = (): void => {
    this.sendHeld();
    this.lastKey = null;
  };

  /** Hand the held edit to the sink. Used where the chain is already being broken by the caller. */
  private sendHeld(): void {
    this.clearForwardTimer();
    const held = this.heldForward;
    this.heldForward = null;
    if (held) this.remote?.({ command: held.command, author: held.author, id: held.id });
  }

  /**
   * (Re-)arm the trailing send. Inside a gesture the end is the real trigger and this is only the
   * stuck-drag backstop; outside one, a quiet coalesce window is the only signal that an edit has
   * settled.
   */
  private armForward(): void {
    this.clearForwardTimer();
    this.forwardTimer = setTimeout(this.flushForward, this.gestureOpen ? GESTURE_IDLE_MS : COALESCE_MS);
  }

  private clearForwardTimer(): void {
    if (this.forwardTimer !== null) clearTimeout(this.forwardTimer);
    this.forwardTimer = null;
  }

  /** Set (or clear with null) the realtime sink that forwards each dispatched edit to the authority.
   *  Flushes first, so a held edit reaches the outgoing sink rather than dying with it. */
  setRemote = (sink: ((edit: ForwardedEdit) => void) | null): void => {
    this.sendHeld();
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
   *
   * It keeps the peer's `id` though (DAW-34 stage E). The seq is local ordering and means nothing to
   * anyone else, but the id is the edit's identity everywhere, so holding it is what lets one machine
   * name an edit another machine made.
   */
  recordRemote = (entry: {
    command: EditCommand;
    author: Author;
    id?: string;
    kind?: "undo" | "redo";
    undoes?: string;
  }): void => {
    const tombstone = entry.undoes !== undefined && (entry.kind === "undo" || entry.kind === "redo");
    this.entries.push({
      seq: this.seq++,
      id: entry.id,
      command: entry.command,
      author: entry.author,
      time: Date.now(),
      kind: entry.kind ?? "edit",
      undoes: entry.undoes,
      ...(tombstone
        ? { label: `${entry.kind === "undo" ? "Undid" : "Redid"}: ${describeCommand(entry.command)}` }
        : {}),
    });
    // A peer's tombstone has to reach the excluded set too, not just the feed. The session has
    // already taken the edit out of the live project; without this the NEXT local undo would rebuild
    // from a set that never heard of it and put it straight back (DAW-34 stage E).
    if (tombstone) {
      if (entry.kind === "undo") this.undone.add(entry.undoes as string);
      else this.undone.delete(entry.undoes as string);
    }
    this.emit();
  };

  undo = (): void => {
    const id = this.undoStack.pop();
    if (id === undefined) return;
    this.redoStack.push(id);
    this.undone.add(id);
    this.rebuildProject();
    this.noteReflog(id, "undo");
  };

  redo = (): void => {
    const id = this.redoStack.pop();
    if (id === undefined) return;
    this.undoStack.push(id);
    this.undone.delete(id);
    this.rebuildProject();
    this.noteReflog(id, "redo");
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
  private noteReflog(id: string, kind: "undo" | "redo"): void {
    const command = this.entries.find((entry) => entry.id === id)?.command;
    const reflogId = this.newEntryId();
    this.entries.push({
      seq: this.seq++,
      id: reflogId,
      command: command ?? ({ type: "commit" } as EditCommand),
      author: this.localAuthor,
      time: Date.now(),
      kind,
      label: `${kind === "undo" ? "Undid" : "Redid"}: ${command ? describeCommand(command) : "an edit"}`,
      // The tombstone (DAW-34 stage E). It was a feed row before, saying an undo happened; naming
      // the edit makes it the record OF the undo, so the log alone says what the project is.
      undoes: id,
    });
    this.lastKey = null;
    // The held edit goes FIRST, so the authority never sees a tombstone for an edit it has not been
    // told about yet.
    this.sendHeld();
    // Then the tombstone itself (DAW-34 stage E). This is what makes undo a shared fact rather than
    // a local one: the authority records it, rebuilds without the edit, and every peer folds the
    // same. With no `command` to show there is no entry to take back either, so there is nothing to
    // forward - the undo was a no-op here too.
    if (command) this.remote?.({ command, author: this.localAuthor, id: reflogId, kind, undoes: id });
    this.emit();
  }

  /** Break the coalesce chain so the next edit starts a fresh entry. Called at a
   *  boundary (e.g. after a commit) so post-commit edits never fold into a
   *  committed entry and slip past "uncommitted" tracking. Sends any held forward for the same
   *  reason: the edit belongs on the near side of the boundary, not after it. */
  resetCoalescing = (): void => {
    this.lastKey = null;
    this.sendHeld();
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

  /** The undo/redo stacks for persistence: two lists of entry ids. */
  getCheckpoints(): UndoState {
    return { undo: this.undoStack.slice(), redo: this.redoStack.slice() };
  }

  /**
   * Restore persisted undo/redo stacks.
   *
   * **Per entry, not all-or-nothing.** An id the restored log does not have as a replayable edit is
   * dropped and the rest are kept, because a step that names a missing entry cannot do harm - a
   * rebuild that excludes nothing produces the project unchanged. That is what replaced DAW-8.15's
   * fingerprint-and-discard, which had to throw away a whole working stack to avoid one that could
   * have rolled the project back.
   *
   * Call it after the project and the log have been restored, or every id looks unknown.
   */
  restoreCheckpoints(stored: UndoState | null): void {
    const known = new Set(
      this.entries.filter((entry) => isReplayable(entry.kind) && entry.id !== undefined).map((entry) => entry.id),
    );
    const keep = (ids: string[] | undefined) => (ids ?? []).filter((id) => known.has(id));
    this.undoStack = keep(stored?.undo);
    this.redoStack = keep(stored?.redo);
    // What is taken back has two sources, and they are different things rather than a duplication.
    //
    // The LOG's tombstones are the confirmed ones: an undo that reached the log, so every reader of
    // it agrees. `undo.json`'s redo list is this client's OPTIMISTIC ones: undone here and not yet
    // in any log - the same base-plus-pending split the shared session makes for edits. A reload has
    // to honour both or it drops whichever half it ignores.
    this.undone = new Set([...tombstonedIds(this.entries), ...this.redoStack]);
    this.dropUnreachable();
    // Then make it so rather than assuming it. Locally the project is written after the undo, so it
    // already matches and this is a no-op; in a shared session the authority wrote it and never
    // heard about the undo, so it does not.
    if (this.undone.size > 0) this.rebuildProject();
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
