/**
 * The realtime authority: one in-memory "room" per project that orders concurrent edits. A room holds
 * the project's live `ProjectStore` (headless - the same DOM-free replay the MCP mirror / repository
 * load use), the current max `seq`, and its connected clients. It is the single serialization point for
 * a project: every inbound edit is assigned the next `seq`, applied, persisted to the `edits` table, and
 * broadcast to every peer as `editApplied`. Clients apply optimistically and reconcile/rebase off that
 * echo (see docs/DESIGN.md, sync-service roadmap).
 *
 * DOM-free (Node): reuses `ProjectStore(false)` + `applyEdit`, exactly like `server/mcpServer.ts` and the
 * repository's replay path. Single-owner for now (auth is stubbed); a room is owner-scoped so real
 * accounts later are a change of principal, not of logic.
 */
import { ProjectStore } from "../../src/audio/project/projectStore";
import { applyEdit } from "../../src/audio/commands/applyEdit";
import type { Author, EditCommand } from "../../src/audio/commands/types";
import type { ProjectData } from "../../src/audio/project/types";
import type { ServerMessage } from "../../src/contract/ws";
import type { Db } from "../db/types";
import { appendEdits, maxEditSeq, readEdits, readFile, type EditEntryInput } from "../db/store";

/** How many recent entries a `snapshot` carries (bounded feed window; matches MAX_PERSISTED_ENTRIES). */
const SNAPSHOT_WINDOW = 2000;

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

  // Explicit field assignment (no constructor parameter-properties: erasableSyntaxOnly forbids them).
  private constructor(db: Db, ownerId: string, projectId: string, store: ProjectStore, maxSeq: number) {
    this.db = db;
    this.ownerId = ownerId;
    this.projectId = projectId;
    this.store = store;
    this.maxSeq = maxSeq;
  }

  /** Load a project's current HEAD into a fresh room: keyframe (`project.json`, if any) + replay the
   *  edit tail after its `headSeq`. With no keyframe, replays the whole stream from empty (still HEAD;
   *  Phase B adds server-written keyframes to bound the replay). */
  static async load(db: Db, ownerId: string, projectId: string): Promise<Room> {
    const store = new ProjectStore(false);
    const projectFile = await readFile(db, ownerId, projectId, "project.json");
    let headSeq = -1;
    if (projectFile?.kind === "json" && projectFile.json) {
      const { headSeq: reflected, ...base } = projectFile.json as ProjectData & { headSeq?: number };
      headSeq = reflected ?? -1;
      store.load(base as ProjectData);
    }
    const tail = await readEdits(db, ownerId, projectId, headSeq);
    for (const entry of tail) {
      if (isReplayable(entry.kind)) applyEdit(store, entry.command as EditCommand, entry.author as Author);
    }
    const maxSeq = await maxEditSeq(db, ownerId, projectId);
    return new Room(db, ownerId, projectId, store, maxSeq);
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  /** The working snapshot (for tests / a Phase-B server keyframe). */
  snapshot(): ProjectData {
    return this.store.snapshot();
  }

  /** Add a client and send it the catch-up `snapshot` (head + recent stream). */
  async subscribe(client: RoomClient): Promise<void> {
    this.clients.add(client);
    // Cast: readEdits types `command` as unknown; at runtime each is the full stored command object.
    const entries = (await readEdits(this.db, this.ownerId, this.projectId, -1, SNAPSHOT_WINDOW)) as SnapshotEntries;
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
    await appendEdits(this.db, this.ownerId, this.projectId, [entry]);
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

  /** Get (or lazily load) the room for a project. Concurrent callers share one load. */
  async get(ownerId: string, projectId: string): Promise<Room> {
    const live = this.rooms.get(projectId);
    if (live) return live;
    const pending = this.loading.get(projectId);
    if (pending) return pending;
    const load = Room.load(this.db, ownerId, projectId).then((room) => {
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
