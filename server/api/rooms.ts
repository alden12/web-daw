/**
 * The realtime authority: one in-memory "room" per project that orders concurrent edits. A room holds
 * the project's live `ProjectStore` (headless - the same DOM-free replay the MCP mirror / repository
 * load use), the current max `seq`, and its connected clients. It is the single serialization point for
 * a project: every inbound edit is assigned the next `seq`, applied, persisted to the `edits` table, and
 * broadcast to every peer as `editApplied`. Clients apply optimistically and reconcile/rebase off that
 * echo (see the apm project, HOST-1).
 *
 * DOM-free (Node): reuses `ProjectStore(false)` + `applyEdit`, exactly like `server/mcpServer.ts` and the
 * repository's replay path. A room is keyed by project id and persists as the project's *real* owner
 * (resolved from the `projects` table), so a shared project is one room regardless of who connects; the
 * registry authorizes each caller (owner or member) before handing back the room.
 */
import { ProjectStore } from "../../src/audio/project/projectStore";
import { applyEdit } from "../../src/audio/commands/applyEdit";
import { headFromLog } from "../../src/audio/commands/replay";
import { commitKeyframePath } from "../../src/audio/history/paths";
import {
  emptyKeyframeIndex,
  KEYFRAME_INDEX_PATH,
  planKeyframes,
  rebuildBase,
  retainedKeyframePath,
  type KeyframeIndex,
} from "../../src/audio/history/keyframes";
import type { Author, EditCommand, EditEntry } from "../../src/audio/commands/types";
import type { ProjectData } from "../../src/audio/project/types";
import type { ServerMessage } from "../../src/contract/ws";
import type { Db } from "../db/types";
import {
  appendEdits,
  deleteEditsBelow,
  ensureUser,
  maxEditSeq,
  readEdits,
  readFile,
  resolveProjectAccess,
  setProjectName,
  writeFile,
  type Accessor,
  type EditEntryInput,
} from "../db/store";

/** How many recent entries a `snapshot` carries (bounded feed window; matches MAX_PERSISTED_ENTRIES). */
const SNAPSHOT_WINDOW = 2000;

/** Write a keyframe every this many edits since the last one, to bound room-reload replay. Mirrors the
 *  client's `KEYFRAME_EDIT_INTERVAL` (src/audio/persistence.ts); far below `SNAPSHOT_WINDOW`, so
 *  compaction only ever prunes once a project's log exceeds the retained feed window. */
const KEYFRAME_INTERVAL = 100;

/** A connected client - anything the room can push a server message to. */
export interface RoomClient {
  send(message: ServerMessage): void;
}

/** An edit as it arrives from a client (before the authority assigns its `seq`). */
export interface IncomingEdit {
  command: EditCommand;
  opId: string;
  author?: Author;
  /** Set on a tombstone (DAW-34 stage E): this takes back (`undo`) or puts back (`redo`) the entry
   *  `undoes` names, rather than applying `command` forward. */
  kind?: "undo" | "redo";
  undoes?: string;
}

/** Version-history markers that pin a keyframe at their seq (a diff / revert-to base): a named `commit`
 *  and a `loadSnapshot` revert. Both are also enumerable history nodes (kept through log compaction). */
const isHistoryMarker = (type: string): boolean => type === "commit" || type === "loadSnapshot";

/** The `snapshot` message's entries field (its `command` is the schema-typed shape, not `unknown`). */
type SnapshotEntries = Extract<ServerMessage, { type: "snapshot" }>["entries"];

export class Room {
  private readonly clients = new Set<RoomClient>();
  /** opId -> assigned seq, so a resent edit (reconnect/retry) re-echoes instead of double-applying. */
  private readonly appliedOps = new Map<string, number>();
  private readonly db: Db;
  private readonly ownerId: string;
  readonly projectId: string;
  private readonly store: ProjectStore;
  private maxSeq: number;
  /** The `seq` the last persisted keyframe (`project.json`) reflects; the replay floor. Seeded from the
   *  loaded keyframe's `headSeq`, advanced when the authority writes a new keyframe. */
  private lastKeyframeSeq: number;
  /** The retained-keyframe ring's slot -> seq map (DAW-34 stage B), cached for the room's life so the
   *  cadence check costs no read. Seeded from the bundle on load. */
  private keyframeIndex: KeyframeIndex;
  /**
   * Everything that happens after an edit is broadcast, run strictly in order (DAW-34 stage E).
   *
   * A tombstone cannot be applied forward, so the store is brought up to date by re-reading the log
   * and rebuilding. That is several awaits, and it must not interleave with the persist of an edit
   * that arrived a moment later - the rebuild would read a log missing that edit and then overwrite
   * the store with a state that has never heard of it. Chaining the after-work keeps the ordering
   * the synchronous section establishes, without holding a lock across the broadcast.
   */
  private afterWork: Promise<unknown> = Promise.resolve();

  // Explicit field assignment (no constructor parameter-properties: erasableSyntaxOnly forbids them).
  private constructor(
    db: Db,
    ownerId: string,
    projectId: string,
    store: ProjectStore,
    maxSeq: number,
    lastKeyframeSeq: number,
    keyframeIndex: KeyframeIndex,
  ) {
    this.db = db;
    this.ownerId = ownerId;
    this.projectId = projectId;
    this.store = store;
    this.maxSeq = maxSeq;
    this.lastKeyframeSeq = lastKeyframeSeq;
    this.keyframeIndex = keyframeIndex;
  }

  /** Load a project's current HEAD into a fresh room: keyframe (`project.json`, if any) + replay the
   *  edit tail after its `headSeq`. The authority writes those keyframes (see `persistKeyframe`), so the
   *  replayed tail stays bounded; with no keyframe yet it replays the whole stream from empty (still HEAD).
   *  `headSeq` seeds `lastKeyframeSeq` so the keyframe cadence carries across reloads. */
  static async load(db: Db, ownerId: string, projectId: string): Promise<Room> {
    // Guarantee the owner exists before we persist any owner-stamped edit (the `projects.owner_id` FK).
    // In production the principal seam already provisioned it; this keeps the authority self-consistent
    // for any caller (and idempotent).
    await ensureUser(db, ownerId);
    const owner: Accessor = { userId: ownerId };
    const maxSeq = await maxEditSeq(db, ownerId, projectId);
    // A missing or malformed ring index reads as empty: it costs undo depth, never data.
    const indexFile = await readFile(db, owner, projectId, KEYFRAME_INDEX_PATH);
    const keyframeIndex =
      indexFile?.kind === "json" && Array.isArray(indexFile.json)
        ? (indexFile.json as KeyframeIndex)
        : emptyKeyframeIndex();
    const room = new Room(db, ownerId, projectId, new ProjectStore(false), maxSeq, -1, keyframeIndex);
    // One reconstruction, shared with the tombstone path: keyframe + the whole retained log with its
    // tombstones honoured. `lastKeyframeSeq` comes back from it so the cadence carries across
    // reloads, which is what the separate `headSeq` read here used to be for.
    room.lastKeyframeSeq = await room.recomputeHead();
    return room;
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  /** The current in-memory HEAD (what `persistKeyframe` writes; also handy in tests). */
  snapshot(): ProjectData {
    return this.store.snapshot();
  }

  /**
   * Persist a keyframe: write `project.json` (the HEAD snapshot + an embedded `headSeq`), then compact the
   * working edit log behind it. `Room.load` reads this keyframe and replays only the tail after `headSeq`,
   * so this bounds cold-start replay. `lastKeyframeSeq` is advanced synchronously (before the await) so a
   * concurrent edit crossing the cadence doesn't double-write. Best-effort: the delta log is the durable
   * truth, so a failed keyframe just means the next load replays a little more.
   */
  private async persistKeyframe(): Promise<void> {
    const headSeq = this.maxSeq;
    if (headSeq <= this.lastKeyframeSeq) return;
    const snapshot = this.store.snapshot();
    this.lastKeyframeSeq = headSeq;
    await writeFile(this.db, { userId: this.ownerId }, this.projectId, "project.json", {
      kind: "json",
      json: { ...snapshot, headSeq },
    });
    await this.retainKeyframe({ ...snapshot, headSeq }, headSeq);
    // Compact: prune entries at/below the keyframe, but keep the most-recent SNAPSHOT_WINDOW so the
    // catch-up feed still has history. `headSeq - SNAPSHOT_WINDOW` is strictly below the keyframe, so the
    // load replay (which reads seq > headSeq) never needs a pruned entry.
    const pruneFloor = headSeq - SNAPSHOT_WINDOW;
    if (pruneFloor >= 0) await deleteEditsBelow(this.db, this.projectId, pruneFloor);
  }

  /**
   * Keep a copy of this keyframe in the retained ring, every `KEYFRAME_RETAIN_INTERVAL` edits, so an
   * undo has a base from BEFORE an edit rather than only the head snapshot, which is always after it
   * (DAW-34 stage B). The ring is a fixed set of slots that overwrite in turn, so it never needs the
   * file delete that neither this store nor the HTTP API has.
   *
   * Best-effort, like the keyframe it copies: the edit log is the durable truth, and a missed write
   * costs undo depth rather than data. The index is cached on the room, which outlives every write.
   */
  private async retainKeyframe(keyframe: Record<string, unknown>, headSeq: number): Promise<void> {
    const plan = planKeyframes(this.keyframeIndex, headSeq);
    this.keyframeIndex = plan.index;
    if (!plan.write) return;
    const who = { userId: this.ownerId };
    await writeFile(this.db, who, this.projectId, retainedKeyframePath(plan.write.slot), {
      kind: "json",
      json: keyframe,
    });
    await writeFile(this.db, who, this.projectId, KEYFRAME_INDEX_PATH, {
      kind: "json",
      json: plan.index as (number | null)[],
    });
  }

  /**
   * The newest retained keyframe from strictly below `belowSeq`, or null when the ring does not
   * reach that far back (DAW-34 stage E).
   *
   * The authority's half of what `ProjectRepository.rebuildBaseFor` does for a client, reading the
   * same ring this room writes in `retainKeyframe`. A slot whose stored `headSeq` disagrees with
   * the index was overwritten under us, so it reads as absent rather than as the wrong base.
   */
  async retainedBaseFor(belowSeq: number): Promise<{ project: ProjectData; seq: number } | null> {
    const slot = rebuildBase(this.keyframeIndex, belowSeq, this.maxSeq);
    if (!slot) return null;
    const file = await readFile(this.db, { userId: this.ownerId }, this.projectId, retainedKeyframePath(slot.slot));
    if (file?.kind !== "json" || !file.json) return null;
    const { headSeq, ...project } = file.json as ProjectData & { headSeq?: number };
    return headSeq === slot.seq ? { project: project as ProjectData, seq: slot.seq } : null;
  }

  /**
   * Pin a keyframe at a commit's seq: write its full HEAD snapshot to the write-once `history/commits/*`
   * path, keyed by seq. Materialising a commit (diff / revert-to) then loads this snapshot directly - zero
   * replay, exact, and durable however old the commit is. Self-contained, so log compaction never affects
   * it; it is stored, never broadcast (peers get the lightweight marker in the edit stream). Best-effort:
   * the marker is already persisted, so a failed keyframe just means that commit can't be materialised
   * until re-derived - it never loses the fact that the commit happened.
   */
  private async persistCommitKeyframe(seq: number, snapshot: ProjectData): Promise<void> {
    await writeFile(this.db, { userId: this.ownerId }, this.projectId, commitKeyframePath(seq), {
      kind: "json",
      json: { ...snapshot, headSeq: seq },
    });
  }

  /** Add a client and send it the catch-up `snapshot` (head + recent stream). */
  async subscribe(client: RoomClient): Promise<void> {
    this.clients.add(client);
    // Cast: readEdits types `command` as unknown; at runtime each is the full stored command object.
    const owner: Accessor = { userId: this.ownerId };
    const entries = (await readEdits(this.db, owner, this.projectId, -1, SNAPSHOT_WINDOW)) as SnapshotEntries;
    client.send({ type: "snapshot", projectId: this.projectId, headSeq: this.maxSeq, entries });
  }

  remove(client: RoomClient): void {
    this.clients.delete(client);
  }

  /**
   * Order + apply + broadcast + persist one incoming edit. Assign `seq`, apply, and broadcast all run
   * synchronously with no `await` between them, so concurrent messages are ordered by arrival with no
   * lock AND every peer sees `editApplied`s in strict `seq` order (a client's reorder guard drops an
   * out-of-order older seq, so broadcast order must match `seq`). The per-seq persist then trails behind,
   * independent and safe to interleave (upsert-by-seq). Returns the broadcast message.
   */
  async applyIncoming(edit: IncomingEdit): Promise<ServerMessage> {
    const author = edit.author ?? "you";
    // Idempotent re-send (a reconnect re-sends unconfirmed ops): re-echo the original seq without
    // applying again. Broadcast it so the originator retires its pending op; peers drop it as a dup
    // (their reorder guard skips a seq at or below head).
    const seen = this.appliedOps.get(edit.opId);
    if (seen !== undefined) {
      const reEcho: ServerMessage = {
        type: "editApplied",
        projectId: this.projectId,
        seq: seen,
        command: edit.command,
        author,
        opId: edit.opId,
      };
      this.broadcast(reEcho);
      return reEcho;
    }
    const seq = ++this.maxSeq;
    // A tombstone takes an edit back OUT, which nothing applied forward can do, so the store is
    // brought up to date by the rebuild queued below rather than here. Its `command` is the command
    // of the edit being undone and is carried only so the feed can name it (DAW-34 stage E).
    const tombstone = edit.kind === "undo" || edit.kind === "redo";
    if (!tombstone) applyEdit(this.store, edit.command, author);
    this.appliedOps.set(edit.opId, seq);
    // A version-history marker pins a keyframe AT its own seq (time-travel base). Snapshot HEAD
    // synchronously here - before any `await` - so a concurrent edit crossing this section can't advance
    // the store first and make the keyframe reflect a later seq. `commit` is a no-op (snapshot = HEAD);
    // `loadSnapshot` (revert) has already loaded its target into the store above (snapshot = that target).
    // Written to storage below (never broadcast); materialising any marker just loads its keyframe.
    const markerSnapshot = !tombstone && isHistoryMarker(edit.command.type) ? this.store.snapshot() : null;
    const applied: ServerMessage = {
      type: "editApplied",
      projectId: this.projectId,
      seq,
      command: edit.command,
      author,
      opId: edit.opId,
      ...(tombstone ? { kind: edit.kind, undoes: edit.undoes } : {}),
    };
    // Broadcast before the persist await, so broadcast order == seq order across concurrent edits.
    this.broadcast(applied);
    // The opId is the edit's identity, minted by the client that made it, so it is what the log
    // stores and what an undo step on any machine names (DAW-34 stage E). `seq` stays this
    // authority's order for it.
    const entry: EditEntryInput = {
      seq,
      id: edit.opId,
      command: edit.command,
      author,
      time: Date.now(),
      kind: edit.kind ?? "edit",
      undoes: edit.undoes,
    };
    // Serialized, so a rebuild cannot read a log that a concurrently-arriving edit has not reached
    // yet and then overwrite the store with a state that never heard of it.
    await this.queueAfterWork(async () => {
      await appendEdits(this.db, { userId: this.ownerId }, this.projectId, [entry]);
      // The tombstone is in the log now, so HEAD is whatever the log says with it honoured.
      if (tombstone) await this.recomputeHead();
      // Keep the queryable index name current on a rename, so every collaborator's listing reflects
      // it without the renamer pushing meta.json (a peer never writes the owner's meta.json).
      if (!tombstone && edit.command.type === "renameProject") {
        await setProjectName(this.db, this.projectId, this.store.name);
      }
      if (markerSnapshot) await this.persistCommitKeyframe(seq, markerSnapshot);
      // Periodically snapshot HEAD to a keyframe (+ compact the log) so a room reload replays only a
      // bounded tail. Runs after the broadcast, so it never delays peers seeing the edit.
      if (this.maxSeq - this.lastKeyframeSeq >= KEYFRAME_INTERVAL) await this.persistKeyframe();
    });
    return applied;
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients) client.send(message);
  }

  /** Run `task` after every task queued before it, whether those succeeded or not. */
  private queueAfterWork(task: () => Promise<unknown>): Promise<unknown> {
    this.afterWork = this.afterWork.then(task, task);
    return this.afterWork;
  }

  /**
   * Re-read the log and rebuild HEAD, honouring its tombstones (DAW-34 stage E).
   *
   * The keyframe is the base, not the live store: the store is HEAD and already has the undone edit
   * in it, and nothing applied forward can take it back out. Returns the keyframe's seq so a cold
   * start can seed its cadence from it.
   */
  private async recomputeHead(): Promise<number> {
    const owner: Accessor = { userId: this.ownerId };
    const projectFile = await readFile(this.db, owner, this.projectId, "project.json");
    let base: { project: ProjectData; seq: number } = { project: new ProjectStore(false).snapshot(), seq: -1 };
    if (projectFile?.kind === "json" && projectFile.json) {
      const { headSeq, ...project } = projectFile.json as ProjectData & { headSeq?: number };
      base = { project: project as ProjectData, seq: headSeq ?? -1 };
    }
    // The whole retained log, not just the tail above the keyframe: a tombstone up there can take
    // back an edit baked INTO the keyframe, which `headFromLog` handles by dropping to an older
    // retained one. Same code the client's `ProjectRepository.load` runs.
    const log = (await readEdits(this.db, owner, this.projectId, -1)) as unknown as EditEntry[];
    this.store.load(await headFromLog({ base, entries: log, olderBase: (below) => this.retainedBaseFor(below) }));
    return base.seq;
  }
}

/** Registry of live rooms, one per project. Lazily loads a room on first access and evicts it when its
 *  last client disconnects (freeing the in-memory `ProjectStore`). */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly loading = new Map<string, Promise<Room>>();
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Get (or lazily load) the room for a project, authorizing the caller first. Returns `null` when the
   * principal may not open the project (not its owner, not a member) - the transport turns that into a
   * refusal. The room is keyed by project id and loaded under the project's *real* owner, so a member
   * joins the same room and their edits persist under the owner (closing the pre-Auth-C hole where the
   * first subscriber's id was baked in). Concurrent callers share one load.
   */
  async get(projectId: string, principal: Accessor): Promise<Room | null> {
    const access = await resolveProjectAccess(this.db, principal, projectId);
    if (!access.allowed) return null;
    const live = this.rooms.get(projectId);
    if (live) return live;
    const pending = this.loading.get(projectId);
    if (pending) return pending;
    const load = Room.load(this.db, access.ownerId, projectId).then((room) => {
      this.rooms.set(projectId, room);
      this.loading.delete(projectId);
      return room;
    });
    this.loading.set(projectId, load);
    return load;
  }

  /** Drop a client from its room; evict the room once empty. */
  leave(projectId: string, client: RoomClient): void {
    const room = this.rooms.get(projectId);
    if (!room) return;
    room.remove(client);
    if (room.connectionCount === 0) this.rooms.delete(projectId);
  }
}
