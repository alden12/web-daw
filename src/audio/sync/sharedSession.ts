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
import type { EditLog } from "../commands/editLog";
import type { Author, EditCommand } from "../commands/types";
import type { ClientMessage, ServerMessage } from "../../contract/ws";

/** A typed, ordered message pipe to the authority. `createWsClient` (src/contract/client.ts) is one. */
export interface SyncTransport {
  send(message: ClientMessage): void;
  onMessage(handler: (message: ServerMessage) => void): void;
  /** Fires each time the socket (re)opens, including the first connect. The session uses it to
   *  (re-)subscribe and re-send unconfirmed edits, so a dropped connection self-heals on reconnect. */
  onOpen(handler: () => void): void;
  close(): void;
}

/** One optimistic edit awaiting the authority's `seq`, matched back by `opId`. */
interface PendingOp {
  opId: string;
  command: EditCommand;
  author: Author;
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

  /** Confirmed, server-ordered state (headless): advanced by `applyEdit` in `seq` order. */
  private readonly base: ProjectStore;
  /** This client's optimistic edits not yet confirmed, in dispatch order. */
  private pending: PendingOp[] = [];
  /** Highest `seq` folded into `base`. */
  private headSeq: number;
  private closed = false;

  constructor(options: SharedSessionOptions) {
    this.projectStore = options.projectStore;
    this.editLog = options.editLog;
    this.transport = options.transport;
    this.projectId = options.projectId;
    this.newOpId = options.newOpId ?? (() => crypto.randomUUID());
    this.onError = options.onError;
    this.onRemoteEdit = options.onRemoteEdit;
    this.headSeq = options.baseSeq ?? -1;

    // Seed `base` from the client's already-loaded HEAD, so a peer rebase replays onto real state
    // (not from empty). The live store == base at start (no pending yet).
    this.base = new ProjectStore(false);
    this.base.load(this.projectStore.snapshot());

    this.transport.onMessage((message) => this.onMessage(message));
    // Every (re)open re-runs `resync`: subscribe (the authority replies with a `snapshot` that folds any
    // edits missed while disconnected) and re-send unconfirmed pending ops. The first connect is just its
    // first firing, so subscribe rides one code path.
    this.transport.onOpen(() => this.resync());
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
    this.sendEdit(op);
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
   * (Re-)establish the session on a transport (re)open: subscribe, then re-send every still-pending op.
   * The subscribe draws a `snapshot` whose `onSnapshot` folds any edits missed while disconnected (the
   * gap-fill), and the re-sends recover local edits whose `editApplied` we may have missed. Both are
   * idempotent by `opId` at the authority, so an op that did reach it before the drop re-echoes its
   * original `seq` instead of double-applying.
   */
  private resync(): void {
    if (this.closed) return;
    this.transport.send({ type: "subscribe", projectId: this.projectId });
    for (const op of this.pending) this.sendEdit(op);
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

  /** Catch-up on subscribe: fold any authoritative entries we do not already have into `base`. */
  private onSnapshot(message: Extract<ServerMessage, { type: "snapshot" }>): void {
    let advanced = false;
    for (const entry of message.entries) {
      if (entry.seq <= this.headSeq) continue;
      if (isReplayable(entry.kind)) applyEdit(this.base, entry.command as EditCommand, entry.author);
      this.headSeq = entry.seq;
      advanced = true;
    }
    // The authority's head can exceed the window we were sent; trust it as the floor for future edits.
    this.headSeq = Math.max(this.headSeq, message.headSeq);
    if (advanced) this.rebuildLive();
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
      this.headSeq = message.seq;
    }
    const index = this.pending.findIndex((op) => op.opId === message.opId);
    if (index >= 0) {
      this.pending.splice(index, 1); // ours: confirmed
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
    this.rebuildLive();
    this.onError?.(`Edit rejected: ${message.reason}`);
  }

  /** Rebuild the live store as `base` with `pending` replayed on top (leaving `base` pristine). */
  private rebuildLive(): void {
    const scratch = new ProjectStore(false);
    scratch.load(this.base.snapshot());
    for (const op of this.pending) applyEdit(scratch, op.command, op.author);
    this.projectStore.load(scratch.snapshot());
  }

  close(): void {
    this.closed = true;
    this.editLog.setRemote(null);
    this.transport.close();
  }
}
