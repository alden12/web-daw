/**
 * The client half of realtime multiplayer: an optimistic, total-order sync session against the
 * server-authoritative `Room` (server/api/rooms.ts). It rides the WS message contract (src/contract/ws.ts).
 *
 * The model (decided in the apm project, HOST-1): the authority assigns a single monotonic
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
import { isReplayable, replayEntries } from "../commands/replay";
import { describeCommand } from "../commands/describe";
import { detectConflict, type ConflictInfo } from "./conflict";
import type { EditLog } from "../commands/editLog";
import type { Author, EditCommand, EditEntry } from "../commands/types";
import type { ProjectData } from "../project/types";
import type { ClientMessage, ServerMessage } from "../../contract/ws";
import { randomUuid } from "../randomUuid";

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
  /** Set on a tombstone (DAW-34 stage E): this takes back (`undo`) or puts back (`redo`) the entry
   *  `undoes` names, rather than applying `command`. */
  kind?: "undo" | "redo";
  undoes?: string;
}

/**
 * How many confirmed entries the session replays from, before the oldest are folded into the base
 * snapshot they sit on. Generous: it only has to span one editing session, and folding is what
 * costs - an edit folded in can no longer be taken back (see `foldConfirmed`).
 */
const CONFIRMED_WINDOW = 2000;

type Snapshot = Extract<ServerMessage, { type: "snapshot" }>;

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
  /** Fired whenever the authoritative log advances (a confirmed edit, commit, or revert - ours or a
   *  peer's), so the remote-mode `VersionStore` re-reads history from the freshly-mirrored log. */
  onConfirmed?: () => void;
  /** Durable local mirror (OPFS) for the pending queue + confirmed stream; omit for no offline durability. */
  localMirror?: LocalMirror;
  /**
   * Re-read the authority's stored HEAD (`project.json` and the seq it reflects).
   *
   * The recovery for a tombstone this session cannot honour: one naming an edit already folded into
   * its seed (DAW-41). Omit it and such a tombstone is reported rather than applied, which is the
   * same call, minus the recovery.
   */
  readAuthoritativeHead?: () => Promise<{ project: ProjectData; seq: number } | null>;
}

/** Only pure-forward edits replay through `applyEdit`; notes / undo-redo markers are skipped. */
export class SharedSession {
  private readonly projectStore: ProjectStore;
  private readonly editLog: EditLog;
  private readonly transport: SyncTransport;
  private readonly projectId: string;
  private readonly newOpId: () => string;
  private readonly onError?: (message: string) => void;
  private readonly onRemoteEdit?: (command: EditCommand, author: Author) => void;
  private readonly onConflict?: (info: ConflictInfo, myState: ProjectData) => void;
  private readonly onConfirmed?: () => void;
  private readonly localMirror?: LocalMirror;
  private readonly readAuthoritativeHead?: () => Promise<{ project: ProjectData; seq: number } | null>;
  /** Re-seeds run one at a time and in order, so two tombstones cannot interleave their reads. */
  private reseeding: Promise<unknown> = Promise.resolve();
  /** Messages held behind a catch-up that is still reading the authority's head; null when none is. */
  private inbox: Promise<void> | null = null;

  /** Confirmed, server-ordered state (headless): advanced by `applyEdit` in `seq` order. */
  private readonly base: ProjectStore;
  /**
   * The snapshot `base` is replayed from, and the confirmed entries replayed onto it (DAW-34 stage E).
   *
   * `base` was a forward-only accumulator, which is fine until a tombstone arrives: taking an edit
   * back OUT is not something any forward apply can do. Keeping what it was built from means it can
   * be rebuilt instead - the same move undo makes locally, one level down.
   *
   * The seed starts as the client's loaded HEAD, so entries from before this session are already in
   * it and cannot be tombstoned. That is the usual "unavailable rather than wrong": the edit stays
   * applied rather than the project going somewhere it never was.
   */
  private seed: ProjectData;
  private confirmed: EditEntry[] = [];
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
    this.newOpId = options.newOpId ?? (() => randomUuid());
    this.onError = options.onError;
    this.onRemoteEdit = options.onRemoteEdit;
    this.onConflict = options.onConflict;
    this.onConfirmed = options.onConfirmed;
    this.localMirror = options.localMirror;
    this.readAuthoritativeHead = options.readAuthoritativeHead;
    this.headSeq = options.baseSeq ?? -1;

    // Seed `base` from the client's already-loaded HEAD, so a peer rebase replays onto real state
    // (not from empty). The live store == base at start (no pending yet).
    this.base = new ProjectStore(false);
    this.seed = this.projectStore.snapshot();
    this.base.load(this.seed);

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
    this.editLog.setRemote((edit) => this.enqueue(edit.command, edit.author, edit));
  }

  /**
   * Enqueue a locally-applied edit for the authority: hold it as a pending optimistic op and send it.
   * `EditLog` has already applied it to the live store; the `editApplied` echo (matched by `opId`)
   * confirms it.
   *
   * An undo/redo routes here too, as a TOMBSTONE (`kind` + `undoes`) rather than an edit, which is
   * what makes an undo a shared fact instead of a local guess. It queues and flushes like any other
   * op, so one made offline reaches the authority on reconnect - but it is never applied FORWARD,
   * here or at the authority; see `rebuildLive`.
   */
  enqueue(
    command: EditCommand,
    author: Author,
    forwarded?: { id: string; kind?: "undo" | "redo"; undoes?: string },
  ): void {
    if (this.closed) return;
    // The log's entry id IS the opId (DAW-34 stage E): one identity for the edit, from the client
    // that made it through to the authority's stored log, so an undo step names the same edit
    // everywhere. Only an edit with no log entry of its own (a commit marker) needs a minted id.
    const op: PendingOp = {
      opId: forwarded?.id ?? this.newOpId(),
      command,
      author,
      ...(forwarded?.kind ? { kind: forwarded.kind, undoes: forwarded.undoes } : {}),
    };
    this.pending.push(op);
    this.persistPending(); // durable before send, so an offline edit survives a reload
    // Send only when synced with the authority. While disconnected (or awaiting a conflict choice) the op
    // stays held in `pending` and is flushed by `onSnapshot` on the next reconnect, after conflict-checking.
    if (this.flushable && !this.conflictHold) this.sendEdit(op);
  }

  /**
   * Author a version-history commit marker into the authoritative edit stream. It is a no-op `commit`
   * edit command, so it rides the exact same path as any edit - queued while offline, flushed on
   * reconnect, assigned an authoritative `seq` by the authority, and broadcast to peers - which is what
   * makes the commit DAG derive cleanly from the log (HEAD = the latest marker's seq) with no mutable
   * pointer to race. The remote-mode `VersionStore` calls this instead of writing commit files.
   */
  postCommit(message: string, author: Author): void {
    this.enqueue({ type: "commit", message }, author);
  }

  /** Persist the current pending queue to the local mirror (best-effort; the queue is small). Returns the
   *  write promise so a caller that must not race it (a fork-then-reload) can await the queue clearing. */
  private persistPending(): Promise<void> {
    return this.localMirror?.savePending(this.pending).catch(() => {}) ?? Promise.resolve();
  }

  /** Append a confirmed authoritative entry to the local edit-log mirror, so an offline reload replays
   *  it back into `base`. Best-effort; `appendEdits` is idempotent by seq so a re-append is a no-op. */
  private mirrorConfirmed(entry: EditEntry): void {
    void this.localMirror?.appendConfirmed(entry).catch(() => {});
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
      ...(op.kind ? { kind: op.kind, undoes: op.undoes } : {}),
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
    // A catch-up across a gap is still reading the authority's head: everything after it waits its turn,
    // or a peer's edit would fold onto the stale base the catch-up is about to replace.
    if (this.inbox) this.holdInbox(() => this.dispatch(message));
    else this.dispatch(message);
  }

  /** Run `work` once everything already held has run, and stop holding when the last of it has. */
  private holdInbox(work: () => void | Promise<void>): void {
    const next = (this.inbox ?? Promise.resolve()).then(work).catch(() => {});
    this.inbox = next;
    void next.then(() => {
      if (this.inbox === next) this.inbox = null;
    });
  }

  private dispatch(message: ServerMessage): void {
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
  private onSnapshot(message: Snapshot): void {
    if (this.spansGap(message)) {
      this.holdInbox(() => this.catchUpAcrossGap(message));
      return;
    }
    // My optimistic state right now (base + pending) is the "keep mine" fork source - capture it before
    // folding the peer's edits shifts `base`.
    this.foldSnapshot(message, this.projectStore.snapshot(), this.headSeq);
  }

  /**
   * Whether the snapshot fails to reach back to where this client left off.
   *
   * It carries the newest `SNAPSHOT_WINDOW` entries, not everything since the client's head, so a
   * client away for longer than that many edits gets a window that starts above it. Folding that
   * window forward replays the recent edits onto a base missing everything in between - silently,
   * since each entry applies fine on its own.
   */
  private spansGap(message: Snapshot): boolean {
    const nextNeeded = this.headSeq + 1;
    const firstUnseen = message.entries.find((entry) => entry.seq > this.headSeq);
    return firstUnseen ? firstUnseen.seq > nextNeeded : message.headSeq >= nextNeeded;
  }

  /**
   * Bridge a gap by starting from the authority's stored head instead of this client's.
   *
   * `project.json` is rewritten every `KEYFRAME_INTERVAL` edits (100), far inside the window (2000),
   * so it lands somewhere the window can take over from: adopt it as the seed and fold the entries
   * above it as usual. The conflict check still sees every edit sent since this client's own head,
   * including the ones now baked into the adopted seed.
   *
   * A head the window cannot take over from leaves nothing honest to fold, so held edits stay held
   * and the user is told to reload, which rebuilds from the authority's files.
   */
  private async catchUpAcrossGap(message: Snapshot): Promise<void> {
    const myState = this.projectStore.snapshot();
    const since = this.headSeq;
    const firstSent = message.entries.find((entry) => entry.seq > since)?.seq ?? message.headSeq + 1;
    const head = await this.readAuthoritativeHead?.().catch(() => null);
    if (this.closed) return;
    if (!head || head.seq < firstSent - 1) {
      this.onError?.("This project moved on too far while you were away to catch up here - reload to see it");
      return;
    }
    this.adoptSeed(head.project, head.seq);
    this.foldSnapshot(message, myState, since);
  }

  /** Fold a snapshot that reaches this client's head, then flush held edits or raise a conflict. */
  private foldSnapshot(message: Snapshot, myState: ProjectData, since: number): void {
    const fresh = message.entries.filter((entry) => entry.seq > this.headSeq) as EditEntry[];
    for (const entry of fresh) {
      this.foldConfirmed(entry);
      this.mirrorConfirmed(entry); // persist for offline reload
      this.headSeq = entry.seq;
    }
    // The authority's head can exceed the window we were sent; trust it as the floor for future edits.
    this.headSeq = Math.max(this.headSeq, message.headSeq);
    // Folded catch-up entries: the log advanced, so let history re-read (markers may have arrived).
    if (fresh.length > 0) this.onConfirmed?.();

    // A reconnect can clash: held offline edits vs the peer edits made since we last synced. Compare only
    // edits authored by someone else - an entry authored by us is our own op recovered via the snapshot
    // (its echo was missed before the drop), not a peer's, so it must never count as a conflict against
    // itself.
    const mineAuthors = new Set(this.pending.map((op) => op.author));
    const peerEdits = message.entries
      .filter((entry) => entry.seq > since && !mineAuthors.has(entry.author))
      .map((entry) => ({ command: entry.command as EditCommand, author: entry.author }));
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
      const entry: EditEntry = {
        seq: message.seq,
        id: message.opId,
        command: message.command as EditCommand,
        author: message.author,
        time: Date.now(),
        kind: message.kind ?? "edit",
        undoes: message.undoes,
      };
      this.foldConfirmed(entry);
      this.mirrorConfirmed(entry); // persist for offline reload
      this.headSeq = message.seq;
    }
    const index = this.pending.findIndex((op) => op.opId === message.opId);
    if (index >= 0) {
      this.pending.splice(index, 1); // ours: confirmed
      this.persistPending(); // durable queue drained of the now-confirmed op
      if (!isNew) this.rebuildLive(); // already in `base` (snapshot-recovered): drop the redundant pending copy
    } else if (isNew) {
      this.rebuildLive(); // a peer's: slot it beneath our still-pending edits
      // Narrate it in the feed, keeping the peer's edit id, so an undo here can name their edit -
      // and, for a tombstone, so the local excluded set agrees with the project we just rebuilt.
      this.editLog.recordRemote({
        command: message.command as EditCommand,
        author: message.author,
        id: message.opId,
        kind: message.kind,
        undoes: message.undoes,
      });
      this.onRemoteEdit?.(message.command as EditCommand, message.author); // let the UI react (e.g. list label)
    }
    // The authoritative log advanced (ours or a peer's): let history re-read the freshly-mirrored markers.
    if (isNew) this.onConfirmed?.();
  }

  /**
   * The authority refused one of our edits: drop the optimistic op and roll it out of the live store.
   *
   * A refused TOMBSTONE needs one thing more (DAW-34 stage E). Dropping it from the queue puts the
   * edit back in the live project, but the log still holds the reflog entry saying it was undone, so
   * the next rebuild would take it straight back out - and the excluded set would keep disagreeing
   * with the authority for as long as the tab lived. `revokeReflog` takes the undo back properly,
   * including putting the step back on the stack it came off.
   */
  private onEditRejected(message: Extract<ServerMessage, { type: "editRejected" }>): void {
    const index = this.pending.findIndex((op) => op.opId === message.opId);
    if (index < 0) return;
    const [rejected] = this.pending.splice(index, 1);
    this.persistPending(); // drop the rejected op from the durable queue too
    if (rejected.undoes !== undefined) this.editLog.revokeReflog(rejected.opId);
    this.rebuildLive();
    this.onError?.(`Edit rejected: ${message.reason}`);
  }

  /**
   * Record a confirmed entry and advance `base` with it.
   *
   * An ordinary edit applies forward, which is cheap. A tombstone cannot, so `base` is rebuilt from
   * the seed with the confirmed log replayed and its tombstones honoured (DAW-34 stage E) - the
   * same rebuild undo makes locally, one level down.
   */
  private foldConfirmed(entry: EditEntry): void {
    this.confirmed.push(entry);
    if (entry.undoes !== undefined && (entry.kind === "undo" || entry.kind === "redo")) {
      // Fold the window down FIRST. Whether this tombstone can be honoured is a question about what
      // will still be replayed, and trimming is what decides that - asking before it trims gets the
      // answer for a window that is about to stop existing.
      this.trimConfirmed();
      if (this.canFold(entry)) this.rebuildBase();
      else if (!this.foldFromLog(entry)) void this.reseedFromAuthority(entry);
      return;
    }
    if (isReplayable(entry.kind)) applyEdit(this.base, entry.command, entry.author);
  }

  /**
   * Whether rebuilding from the seed could actually honour this tombstone.
   *
   * It can only leave out an edit it still replays, and `trimConfirmed` folds the oldest entries INTO
   * the seed - where they are baked in and no forward replay can remove them. So a tombstone naming
   * one of those rebuilds to a project that still contains the edit it takes back, silently, and the
   * client then disagrees with the authority with nothing to say so (DAW-41).
   *
   * A REDO needs the same thing, which is not what this said at first. It reads as the safe direction
   * - putting an edit back rather than taking one out - but the seed it replays onto may be one this
   * session ADOPTED after a deep undo, in which case the edit is baked out of it and there is nothing
   * in the window to put back. The redo then vanished silently, which is the exact bug this check
   * exists to prevent, arriving from the other side.
   */
  private canFold(entry: EditEntry): boolean {
    return this.confirmed.some((each) => each.id === entry.undoes);
  }

  /**
   * Derive it from the edit log, which reaches further back than this session does.
   *
   * The session's own account of history starts when the tab opened: its seed is the project as
   * loaded and `confirmed` holds only what has arrived since. So an undo of anything from BEFORE
   * that - after a reload, or a tab that joined late - is unfoldable here while being perfectly
   * reachable in `EditLog`, which keeps the loaded entries and a base at the oldest retained
   * keyframe. That is the common case by some distance, and it needs no network at all.
   *
   * Pending is excluded because what is wanted is the authority's state, not ours; `rebuildLive`
   * puts our unconfirmed edits back on top immediately afterwards.
   *
   * Works in both directions: the log is rebuilt with the reflog entry applied, so a redo puts its
   * edit back just as an undo takes one out.
   */
  private foldFromLog(entry: EditEntry): boolean {
    const rebuilt = this.editLog.rebuiltFor(
      { undoes: entry.undoes as string, kind: entry.kind === "redo" ? "redo" : "undo" },
      new Set(this.pending.map((op) => op.opId)),
    );
    if (!rebuilt) return false;
    this.adoptSeed(rebuilt, entry.seq);
    return true;
  }

  /**
   * Take the authority's word for it: re-read its stored HEAD and rebuild from there.
   *
   * The authority rebuilt without the undone edit and wrote the result to `project.json` before
   * broadcasting (see `Room.applyIncoming`), so that file is a base this session cannot compute for
   * itself. Entries above it still replay on top, which keeps anything that arrived meanwhile - and
   * `pending` is replayed by `rebuildLive`, so unsent local work survives the swap.
   *
   * Serialized through `reseeding`, and it re-checks the seq it got back: a keyframe still older than
   * the undone edit cannot help, and applying it would roll the project backwards. Then there is
   * nothing to do but say so, which is the honest end of "unavailable rather than wrong".
   */
  private reseedFromAuthority(entry: EditEntry): Promise<void> {
    const recover = async () => {
      const head = await this.readAuthoritativeHead?.().catch(() => null);
      if (!head || head.seq < entry.seq) {
        this.onError?.("An undo from another device could not be applied here - reload to catch up");
        return;
      }
      this.adoptSeed(head.project, head.seq);
    };
    this.reseeding = this.reseeding.then(recover, recover);
    return this.reseeding as Promise<void>;
  }

  /**
   * Take `project` as the confirmed state at `seq`: everything up to there is in the seed, whatever
   * arrived above it still replays, and `rebuildLive` puts `pending` back on top.
   */
  private adoptSeed(project: ProjectData, seq: number): void {
    this.seed = project;
    this.confirmed = this.confirmed.filter((each) => each.seq > seq);
    this.headSeq = Math.max(this.headSeq, seq);
    this.rebuildBase();
    // The log rebuilds undo from its OWN base, which is now behind what we just accepted. Left
    // alone, the two disagree from here on and the next ordinary undo rebuilds the deep edit back
    // into the project (DAW-38 step 5). Pending is named so it stays above the new base.
    this.editLog.rebaseOnto(this.base.snapshot(), new Set(this.pending.map((op) => op.opId)));
    this.rebuildLive();
  }

  /** `base` as the confirmed log says it is: the seed, replayed, with its tombstones honoured.
   *  The caller trims first, because what survives the trim is what decides whether this can work. */
  private rebuildBase(): void {
    const scratch = new ProjectStore(false);
    scratch.load(this.seed);
    replayEntries(scratch, this.confirmed);
    this.base.load(scratch.snapshot());
  }

  /**
   * Keep the replayable window finite by folding the oldest confirmed entries into the seed.
   *
   * What folding costs is undo depth: an edit inside the seed can no longer be taken back, because
   * there is nothing left to replay without. The window is wide enough that only a very long single
   * session reaches it, and the alternative is a list that grows for as long as the tab is open.
   */
  private trimConfirmed(): void {
    if (this.confirmed.length <= CONFIRMED_WINDOW) return;
    const fold = this.confirmed.splice(0, this.confirmed.length - CONFIRMED_WINDOW);
    const scratch = new ProjectStore(false);
    scratch.load(this.seed);
    replayEntries(scratch, fold);
    this.seed = scratch.snapshot();
  }

  /**
   * Rebuild the live store as `base` with `pending` replayed on top (leaving `base` pristine). During
   * a conflict hold, pending is NOT replayed, so the live store shows the peer's (authoritative)
   * state while the user decides.
   *
   * **A tombstone in `pending` cannot be applied forward.** Its `command` is the command of the edit
   * being taken back (carried so a feed can name it), so replaying it forward re-applies the very
   * edit the undo removed - and every rebuild is a chance to do that: a peer's edit, a reconnect, an
   * offline reload replaying its saved queue. `EditLog.undo` gets the project right at the moment it
   * is pressed, which is why this went unnoticed until an undo made offline came back.
   *
   * So a queue holding an unsent undo takes the long way: replay the whole stream from the seed with
   * its tombstones honoured, exactly as `rebuildBase` does one level down, because what the undo
   * excludes may be baked into `base` and nothing applied forward can take it out again. With no
   * tombstone pending - every other rebuild, which is nearly all of them - `base` is already
   * tombstone-aware and the cheap forward replay is correct.
   */
  private rebuildLive(): void {
    // A drag in progress is one held forward, not yet in `pending` (DAW-8.13), and this rebuild
    // replaces the live project with `base` + `pending` - so without this the rebuild would throw
    // away the part of the drag that has happened so far.
    this.editLog.flushForward();
    const scratch = new ProjectStore(false);
    if (this.conflictHold || !this.pending.some((op) => op.undoes !== undefined)) {
      scratch.load(this.base.snapshot());
      if (!this.conflictHold) for (const op of this.pending) applyEdit(scratch, op.command, op.author);
    } else {
      // `replayEntries` works the tombstones out over everything it is given, so the confirmed log
      // and the queue are replayed as one stream and an undo of either is honoured. An edit already
      // folded into the seed cannot be excluded, which costs undo depth exactly as folding does for
      // `base` - see `trimConfirmed`.
      scratch.load(this.seed);
      replayEntries(scratch, this.confirmed.concat(this.pending.map(this.asEntry)));
    }
    this.projectStore.load(scratch.snapshot());
  }

  /** A pending op as a log entry, so it can be replayed alongside the confirmed stream. Its `seq`
   *  sits above the confirmed head, which is where it will land if the authority accepts it. */
  private readonly asEntry = (op: PendingOp, index: number): EditEntry => ({
    seq: this.headSeq + 1 + index,
    id: op.opId,
    command: op.command,
    author: op.author,
    time: Date.now(),
    kind: op.kind ?? "edit",
    undoes: op.undoes,
  });

  close(): void {
    this.editLog.setRemote(null); // flushes a held edit while the session can still send it
    this.closed = true;
    this.transport.close();
  }
}
