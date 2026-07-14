/**
 * The realtime authority: one in-memory "room" per project that orders concurrent edits. A room holds
 * the project's live `ProjectStore` (headless - the same DOM-free replay the MCP mirror / repository
 * load use), the current max `seq`, and its connected clients. It is the single serialization point for
 * a project: every inbound edit is assigned the next `seq`, applied, persisted to the `edits` table, and
 * broadcast to every peer as `editApplied`. Clients apply optimistically and reconcile/rebase off that
 * echo (see docs/DESIGN.md, sync-service roadmap).
 *
 * DOM-free (Node): reuses `ProjectStore(false)` + `applyEdit`, exactly like `server/mcpServer.ts` and the
 * repository's replay path. A room is keyed by project id and persists as the project's *real* owner
 * (resolved from the `projects` table), so a shared project is one room regardless of who connects; the
 * registry authorizes each caller (owner or member) before handing back the room.
 */
import { ProjectStore } from "../../src/audio/project/projectStore";
import { applyEdit } from "../../src/audio/commands/applyEdit";
import type { Author, EditCommand } from "../../src/audio/commands/types";
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
}

/** Only pure-forward edits replay through `applyEdit`; notes and undo/redo markers are skipped. */
const isReplayable = (kind: string | undefined): boolean => kind === undefined || kind === "edit";

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

  // Explicit field assignment (no constructor parameter-properties: erasableSyntaxOnly forbids them).
  private constructor(
    db: Db,
    ownerId: string,
    projectId: string,
    store: ProjectStore,
    maxSeq: number,
    lastKeyframeSeq: number,
  ) {
    this.db = db;
    this.ownerId = ownerId;
    this.projectId = projectId;
    this.store = store;
    this.maxSeq = maxSeq;
    this.lastKeyframeSeq = lastKeyframeSeq;
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
    const store = new ProjectStore(false);
    const projectFile = await readFile(db, owner, projectId, "project.json");
    let headSeq = -1;
    if (projectFile?.kind === "json" && projectFile.json) {
      const { headSeq: reflected, ...base } = projectFile.json as ProjectData & { headSeq?: number };
      headSeq = reflected ?? -1;
      store.load(base as ProjectData);
    }
    const tail = await readEdits(db, owner, projectId, headSeq);
    for (const entry of tail) {
      if (isReplayable(entry.kind)) applyEdit(store, entry.command as EditCommand, entry.author as Author);
    }
    const maxSeq = await maxEditSeq(db, ownerId, projectId);
    return new Room(db, ownerId, projectId, store, maxSeq, headSeq);
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
    // Compact: prune entries at/below the keyframe, but keep the most-recent SNAPSHOT_WINDOW so the
    // catch-up feed still has history. `headSeq - SNAPSHOT_WINDOW` is strictly below the keyframe, so the
    // load replay (which reads seq > headSeq) never needs a pruned entry.
    const pruneFloor = headSeq - SNAPSHOT_WINDOW;
    if (pruneFloor >= 0) await deleteEditsBelow(this.db, this.projectId, pruneFloor);
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
    applyEdit(this.store, edit.command, author);
    this.appliedOps.set(edit.opId, seq);
    const applied: ServerMessage = {
      type: "editApplied",
      projectId: this.projectId,
      seq,
      command: edit.command,
      author,
      opId: edit.opId,
    };
    // Broadcast before the persist await, so broadcast order == seq order across concurrent edits.
    this.broadcast(applied);
    const entry: EditEntryInput = { seq, command: edit.command, author, time: Date.now(), kind: "edit" };
    await appendEdits(this.db, { userId: this.ownerId }, this.projectId, [entry]);
    // Keep the queryable index name current on a rename, so every collaborator's listing reflects it
    // without the renamer pushing meta.json (a peer never writes the owner's meta.json).
    if (edit.command.type === "renameProject") await setProjectName(this.db, this.projectId, this.store.name);
    // Periodically snapshot HEAD to a keyframe (+ compact the log) so a room reload replays only a bounded
    // tail. Runs after the broadcast, so it never delays peers seeing the edit.
    if (this.maxSeq - this.lastKeyframeSeq >= KEYFRAME_INTERVAL) await this.persistKeyframe();
    return applied;
  }

  private broadcast(message: ServerMessage): void {
    for (const client of this.clients) client.send(message);
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
