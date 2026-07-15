/**
 * The client half of realtime multiplayer: an optimistic, total-order sync session against the
 * server-authoritative `Room` (server/api/rooms.ts). It rides the WS message contract (src/contract/ws.ts).
 *
 * The model (decided in docs/DESIGN.md, sync-service roadmap): the authority assigns a single monotonic
 * `seq` to every edit; the client applies its own edits *immediately* (optimistically) and reconciles off
 * the authority's echo. We keep two views:
 *   - `base`  - the confirmed, server-ordered state (a headless ProjectStore advanced by `applyEdit` in
 *               strict `seq` order as `editApplied`s arrive).
 *   - `pending` - this client's optimistic edits not yet confirmed, in dispatch order.
 * The live UI store is always `base + pending`. When a peer's edit lands, we advance `base` and *rebase*:
 * rebuild the live store as `base` with `pending` replayed on top, so the peer edit slots underneath our
 * unconfirmed work. Our own confirmations just advance `base` and drop the matching pending op - the live
 * store already matches, so no rebuild is needed. Same-target clashes resolve last-writer-wins by `seq`,
 * and a stale-target edit (e.g. add-to-a-just-removed-track) no-ops in `applyEdit` - so total order alone
 * converges, with no OT/CRDT (see the plan's rebase model).
 *
 * Optimistic apply + local feed/undo stay with the existing `EditLog` (its `dispatch` mutates the live
 * store, records the feed entry, and pushes an undo checkpoint). This session layers ordering on top:
 * it does not re-apply on dispatch, only on reconcile. Collaborative undo and a shared feed are later
 * phases - undo here is local best-effort (its snapshots predate a rebase), which is an accepted A2 limit.
 */
import { ProjectStore } from "../project/projectStore";
import { applyEdit } from "../commands/applyEdit";
import { describeCommand } from "../commands/describe";
import { detectConflict, type ConflictInfo } from "./conflict";
import type { EditLog } from "../commands/editLog";
import type { Author, EditCommand, EditEntry } from "../commands/types";
import type { ProjectData } from "../project/types";
import type { ClientMessage, ServerMessage } from "../../contract/ws";

/** A typed, ordered message pipe to the authority. `createWsClient` (src/contract/client.ts) is one. */
export interface SyncTransport {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): void;
  /** Fires each time the socket (re)opens, including the first connect. The session uses it to
   *  (re-)subscribe and re-send unconfirmed edits, so a dropped connection self-heals on reconnect. */
  onOpen(handler: () => void): void;
  /** Fires when the socket drops (offline) or is suspended (idle). The session uses it to stop sending,
   *  so edits made while disconnected are HELD locally (not handed to the transport backlog) until a
   *  reconnect can conflict-check them against any peer edits missed in the meantime. */
  onClose(handler: () => void): void;
  close(): void;
}

/** One optimistic edit awaiting the authority's `seq`, matched back by `opId`. */
export interface PendingOp {
  opId: string;
  command: EditCommand;
  author: Author;
}

/**
 * The durable local mirror (OPFS, cache-only) that makes offline work survive a reload:
 * - the pending write-queue (`loadPending`/`savePending`) - unconfirmed ops re-applied to the live
 *   store on reload and re-sent on reconnect;
 * - the confirmed edit stream (`appendConfirmed`) - each authoritative `editApplied` appended to the
 *   local edit log so an offline reload replays it back to the correct HEAD.
 * All writes are best-effort: the server remains the source of truth, so a failed mirror write only
 * means the next reload reconstructs a little less. Absent (undefined) in remote-without-OPFS / local.
 */
export interface LocalMirror {
  loadPending(): Promise<PendingOp[]>;
  savePending(pending: PendingOp[]): Promise<void>;
  appendConfirmed(entry: EditEntry): Promise<void>;
}

export interface SharedSessionOptions {
  projectStore: ProjectStore;
  editLog: EditLog;
  transport: SyncTransport;
  projectId: string;
  /** The last authoritative `seq` this client already has locally (from its HTTP-loaded HEAD). Edits at
   *  or below it are already applied, so catch-up on `snapshot` skips them. Defaults to -1 (genesis). */
  baseSeq?: number;
  /** Injectable id generator (deterministic in tests); defaults to `crypto.randomUUID`. */
  newOpId?: () => string;
  /** Surface a rejected edit / transport note to the UI. */
  onError?: (message: string) => void;
  /** Fired when a *peer's* new edit is applied (not our own echoes). Lets the UI react to remote changes
   *  beyond the store - e.g. refresh the project-list label on a `renameProject`. */
  onRemoteEdit?: (command: EditCommand, author: Author) => void;
  /** Fired on reconnect when this client's held (offline) edits clash with a peer's edits made in the
   *  meantime. The held edits are NOT sent; the live store shows the peer's state. The UI resolves by
   *  calling `discardPending` (take theirs) or forking a copy from `myState` (keep mine). */
  onConflict?: (info: ConflictInfo, myState: ProjectData) => void;
  /** Durable local mirror (OPFS) for the pending queue + confirmed stream; omit for no offline durability. */
  localMirror?: LocalMirror;
}

/** Only pure-forward edits replay through `applyEdit`; notes / undo-redo markers are skipped. */
const isReplayable = (kind: string | undefined): boolean => kind === undefined || kind === "edit";

export class SharedSession {
  private readonly projectStore: ProjectStore;
  private readonly editLog: EditLog;
  private readonly transport: SyncTransport;
  private readonly projectId: string;
  private readonly newOpId: () => string;
  private readonly onError?: (message: string) => void;
  private readonly onRemoteEdit?: (command: EditCommand, author: Author) => void;
  private readonly onConflict?: (info: ConflictInfo, myState: ProjectData) => void;
  private readonly localMirror?: LocalMirror;

  /** Confirmed, server-ordered state (headless): advanced by `applyEdit` in `seq` order. */
  private readonly base: ProjectStore;
  /** This client's optimistic edits not yet confirmed, in dispatch order. */
  private pending: PendingOp[] = [];
  /** Highest `seq` folded into `base`. */
  private headSeq: number;
  private closed = false;
  /** True once we've subscribed and folded the authority's catch-up `snapshot`, so pending edits may be
   *  sent. False while disconnected/suspended - edits made then are HELD (not handed to the transport)
   *  until the next `snapshot` can conflict-check them. Also false during a `conflictHold`. */
  private flushable = false;
  /** True while a reconnect conflict is awaiting the user's choice: the live store shows the peer's state
   *  (pending replayed OFF), and pending is neither sent nor dropped until resolved. */
  private conflictHold = false;

  constructor(options: SharedSessionOptions) {
    this.projectStore = options.projectStore;
    this.editLog = options.editLog;
    this.transport = options.transport;
    this.projectId = options.projectId;
    this.newOpId = options.newOpId ?? (() => crypto.randomUUID());
    this.onError = options.onError;
    this.onRemoteEdit = options.onRemoteEdit;
    this.onConflict = options.onConflict;
    this.localMirror = options.localMirror;
    this.headSeq = options.baseSeq ?? -1;

    // Seed `base` from the client's already-loaded HEAD, so a peer rebase replays onto real state
    // (not from empty). The live store == base at start (no pending yet).
    this.base = new ProjectStore(false);
    this.base.load(this.projectStore.snapshot());

    this.transport.onMessage((message) => this.onMessage(message));
    // Every (re)open re-runs `resync`: subscribe so the authority replies with a `snapshot` folding any
    // edits missed while disconnected. Pending ops are flushed only AFTER that snapshot (in `onSnapshot`),
    // once we can conflict-check them - see the send-gating note on `flushable`.
    this.transport.onOpen(() => this.resync());
    // A drop/suspend stops us sending: edits made while disconnected are held in `pending` (not pushed to
    // the transport backlog), so the next reconnect can conflict-check them before they reach the authority.
    this.transport.onClose(() => {
      this.flushable = false;
    });
    // Restore any durable pending ops from a previous (offline) session and re-apply them to the live
    // store, so an offline reload does not lose unsent edits. Fire-and-forget: `resync` re-sends them
    // once connected (and if the socket is already open, `restorePending` sends them itself).
    if (this.localMirror) void this.restorePending();
  }

  /** Re-load unsent ops persisted before a reload and re-apply them on top of `base`. They are NOT sent
   *  here: the next `snapshot` flushes them (after conflict-checking against any peer edits since). */
  private async restorePending(): Promise<void> {
    const saved = await this.localMirror!.loadPending();
    if (this.closed || saved.length === 0) return;
    // Drop any we already hold (a race with fresh enqueues), then prepend the restored ops in order.
    const held = new Set(this.pending.map((op) => op.opId));
    const restored = saved.filter((op) => !held.has(op.opId));
    if (restored.length === 0) return;
    this.pending = restored.concat(this.pending);
    this.rebuildLive();
  }

  /** Attach to an `EditLog` as its remote sink: every locally-dispatched edit is enqueued for the
   *  authority (after `EditLog` has already applied it optimistically). Detaches on `close()`. */
  attach(): void {
    this.editLog.setRemote((command, author) => this.enqueue(command, author));
  }

  /**
   * Enqueue a locally-applied edit for the authority: hold it as a pending optimistic op and send it.
   * `EditLog` has already applied it to the live store; the `editApplied` echo (matched by `opId`)
   * confirms it. Undo/redo do NOT route here - they are local best-effort in a shared session.
   */
  enqueue(command: EditCommand, author: Author): void {
    if (this.closed) return;
    const op: PendingOp = { opId: this.newOpId(), command, author };
    this.pending.push(op);
    this.persistPending(); // durable before send, so an offline edit survives a reload
    // Send only when synced with the authority. While disconnected (or awaiting a conflict choice) the op
    // stays held in `pending` and is flushed by `onSnapshot` on the next reconnect, after conflict-checking.
    if (this.flushable && !this.conflictHold) this.sendEdit(op);
  }

  /** Persist the current pending queue to the local mirror (best-effort; the queue is small). Returns the
   *  write promise so a caller that must not race it (a fork-then-reload) can await the queue clearing. */
  private persistPending(): Promise<void> {
    return this.localMirror?.savePending(this.pending).catch(() => {}) ?? Promise.resolve();
  }

  /** Append a confirmed authoritative entry to the local edit-log mirror, so an offline reload replays
   *  it back into `base`. Best-effort; `appendEdits` is idempotent by seq so a re-append is a no-op. */
  private mirrorConfirmed(command: EditCommand, author: Author, seq: number): void {
    void this.localMirror?.appendConfirmed({ seq, command, author, time: Date.now(), kind: "edit" }).catch(() => {});
  }

  /** Wire one pending op to the authority. `baseSeq` reflects the latest confirmed head (informational
   *  for the authority); `opId` matches the echo and dedups a re-send after a reconnect. */
  private sendEdit(op: PendingOp): void {
    this.transport.send({
      type: "edit",
      projectId: this.projectId,
      command: op.command,
      opId: op.opId,
      baseSeq: this.headSeq,
      author: op.author,
    });
  }

  /**
   * (Re-)establish the session on a transport (re)open: subscribe. The authority replies with a
   * `snapshot` whose `onSnapshot` folds any edits missed while disconnected (the gap-fill) and THEN,
   * once a conflict check has passed, flushes still-pending ops. Deferring the flush to after the
   * snapshot is what lets a reconnect hold clashing offline edits back instead of blindly merging them.
   */
  private resync(): void {
    if (this.closed) return;
    this.transport.send({ type: "subscribe", projectId: this.projectId });
  }

  private onMessage(message: ServerMessage): void {
    if (this.closed) return;
    const handlers: Record<ServerMessage["type"], () => void> = {
      snapshot: () => message.type === "snapshot" && this.onSnapshot(message),
      editApplied: () => message.type === "editApplied" && this.onEditApplied(message),
      editRejected: () => message.type === "editRejected" && this.onEditRejected(message),
      error: () => message.type === "error" && this.onError?.(message.message),
      pong: () => {},
    };
    handlers[message.type]();
  }

  /**
   * Catch-up on subscribe: fold authoritative entries we do not already have into `base`, then either
   * flush our held pending ops or - if they clash with a peer's edits since we last synced - hold them
   * and raise the conflict for the UI to resolve.
   */
  private onSnapshot(message: Extract<ServerMessage, { type: "snapshot" }>): void {
    // My optimistic state right now (base + pending) is the "keep mine" fork source - capture it before
    // folding the peer's edits shifts `base`.
    const myState = this.projectStore.snapshot();
    const missed: { command: EditCommand; author: Author }[] = [];
    for (const entry of message.entries) {
      if (entry.seq <= this.headSeq) continue;
      if (isReplayable(entry.kind)) applyEdit(this.base, entry.command as EditCommand, entry.author);
      this.mirrorConfirmed(entry.command as EditCommand, entry.author, entry.seq); // persist for offline reload
      this.headSeq = entry.seq;
      missed.push({ command: entry.command as EditCommand, author: entry.author });
    }
    // The authority's head can exceed the window we were sent; trust it as the floor for future edits.
    this.headSeq = Math.max(this.headSeq, message.headSeq);

    // A reconnect can clash: held offline edits vs the peer edits we just folded. Compare only edits
    // authored by someone else - an entry authored by us is our own op recovered via the snapshot (its
    // echo was missed before the drop), not a peer's, so it must never count as a conflict against itself.
    const mineAuthors = new Set(this.pending.map((op) => op.author));
    const peerEdits = missed.filter((entry) => !mineAuthors.has(entry.author));
    const held = this.pending.map((op) => ({ command: op.command, author: op.author }));
    const conflict = this.conflictHold ? null : detectConflict(peerEdits, held, this.describe);
    if (conflict) {
      this.conflictHold = true; // live shows the peer's state; pending neither sent nor dropped yet
      this.rebuildLive();
      this.onConflict?.(conflict, myState);
      return;
    }
    if (this.conflictHold) {
      // A re-sync arrived while the user is still choosing: keep holding (show the latest peer state,
      // don't flush the held ops out from under the open dialog).
      this.rebuildLive();
      return;
    }
    this.rebuildLive();
    this.flushable = true; // synced: send held ops (and let live edits send immediately from here on)
    for (const op of this.pending) this.sendEdit(op);
  }

  /** Human phrase for a command (for the conflict dialog), resolving ids to current track/group names. */
  private readonly describe = (command: EditCommand): string =>
    describeCommand(command, {
      name: (id) => this.projectStore.getTrack(id)?.name ?? this.projectStore.getGroup(id)?.name,
    });

  /**
   * Resolve a held conflict by taking the peer's edits: drop this client's held ops (also from the
   * durable queue) and rebuild the live store as the peer's state. "Keep mine as a copy" is the UI's job
   * (fork a new project from the `myState` it received) and then calls this to converge the shared one.
   */
  discardPending(): Promise<void> {
    this.pending = [];
    this.conflictHold = false;
    this.flushable = true;
    this.rebuildLive();
    // Return the mirror-clear write: "keep mine as a copy" reloads right after, and must not race it or
    // the original project's `pending.json` would still hold the discarded ops and resurrect them.
    return this.persistPending();
  }

  /**
   * The authority ordered an edit. A `seq` we have not folded yet advances `base`; one already folded
   * (a dup, a reorder, or an op recovered via a reconnect `snapshot`) does not. Either way, if it echoes
   * one of our pending ops we retire it: when it was fresh the live store already reflects it (base +
   * remaining pending), but when it was already in `base` via a snapshot we must rebuild to drop the now-
   * redundant pending copy. A peer's fresh edit (an `opId` we do not hold) rebases beneath our pending.
   */
  private onEditApplied(message: Extract<ServerMessage, { type: "editApplied" }>): void {
    const isNew = message.seq > this.headSeq;
    if (isNew) {
      applyEdit(this.base, message.command as EditCommand, message.author);
      this.mirrorConfirmed(message.command as EditCommand, message.author, message.seq); // persist for offline reload
      this.headSeq = message.seq;
    }
    const index = this.pending.findIndex((op) => op.opId === message.opId);
    if (index >= 0) {
      this.pending.splice(index, 1); // ours: confirmed
      this.persistPending(); // durable queue drained of the now-confirmed op
      if (!isNew) this.rebuildLive(); // already in `base` (snapshot-recovered): drop the redundant pending copy
    } else if (isNew) {
      this.rebuildLive(); // a peer's: slot it beneath our still-pending edits
      this.editLog.recordRemote(message.command as EditCommand, message.author); // narrate it in the feed
      this.onRemoteEdit?.(message.command as EditCommand, message.author); // let the UI react (e.g. list label)
    }
  }

  /** The authority refused one of our edits: drop the optimistic op and roll it out of the live store. */
  private onEditRejected(message: Extract<ServerMessage, { type: "editRejected" }>): void {
    const index = this.pending.findIndex((op) => op.opId === message.opId);
    if (index < 0) return;
    this.pending.splice(index, 1);
    this.persistPending(); // drop the rejected op from the durable queue too
    this.rebuildLive();
    this.onError?.(`Edit rejected: ${message.reason}`);
  }

  /** Rebuild the live store as `base` with `pending` replayed on top (leaving `base` pristine). During a
   *  conflict hold, pending is NOT replayed, so the live store shows the peer's (authoritative) state
   *  while the user decides. */
  private rebuildLive(): void {
    const scratch = new ProjectStore(false);
    scratch.load(this.base.snapshot());
    if (!this.conflictHold) for (const op of this.pending) applyEdit(scratch, op.command, op.author);
    this.projectStore.load(scratch.snapshot());
  }

  close(): void {
    this.closed = true;
    this.editLog.setRemote(null);
    this.transport.close();
  }
}
