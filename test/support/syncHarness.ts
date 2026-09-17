/**
 * The deterministic sync harness: a `Room` with fully controllable clients, shared by every test that
 * drives the authority and a client together.
 *
 * Client -> server messages queue on a shared `serverQueue` (drained by `pump()` in enqueue order, so
 * a test picks who reaches the authority first); server -> client messages queue in each client's
 * `inbox` (drained by `flush()`), so a test controls the order a client observes edits. That is what
 * reproduces the rebase-over-pending case: a peer's edit arriving while this client's own is still
 * unconfirmed.
 *
 * It lives here rather than in one test file because three files used to keep their own copy, and a
 * copy of a boundary tests the copy: a tombstone reached a room in all three and was dropped on the
 * real WebSocket path, because each harness listed the fields it forwarded and so did `wsServer`.
 * Everything that stands in for the ws server now goes through `incomingEdit`, from one place.
 */
import { incomingEdit, Room, type RoomClient } from "../../server/api/rooms";
import {
  SharedSession,
  type LocalMirror,
  type PendingOp,
  type SyncTransport,
} from "../../src/audio/sync/sharedSession";
import { ProjectStore } from "../../src/audio/project/projectStore";
import { EditLog } from "../../src/audio/commands/editLog";
import type { ConflictInfo } from "../../src/audio/sync/conflict";
import type { ProjectData } from "../../src/audio/project/types";
import type { EditEntry } from "../../src/audio/commands/types";
import type { ClientMessage, ServerMessage } from "../../src/contract/ws";

// A deterministic, fully controllable transport harness. Client -> server messages queue on a shared
// `serverQueue` (drained by `pump()` in enqueue order, so the test picks who reaches the authority
// first); server -> client messages queue in each client's `inbox` (drained by `flush()`), so the test
// controls the order a client observes edits. This reproduces the rebase-over-pending case: a peer's
// edit reaching a client while its own edit is still unconfirmed.
export class Harness {
  readonly room: Room;
  private readonly serverQueue: Array<() => Promise<unknown>> = [];
  readonly clients: Client[] = [];

  constructor(room: Room) {
    this.room = room;
  }

  connect(id: string, userId?: string): Client {
    const client = new Client(id, this.room, this.serverQueue);
    if (userId) client.editLog.setLocalAuthor(userId);
    this.clients.push(client);
    return client;
  }

  /**
   * Drain queued client -> server operations (subscribe / edit) in enqueue order.
   *
   * Settles every client's gesture first: a coalescable edit is held until its drag ends (DAW-8.13),
   * and a test's `dispatch` stands for a finished one. Without this a held `editNotes` would not
   * have reached the authority by the time the test asserts on it.
   */
  async pump(): Promise<void> {
    for (const client of this.clients) client.editLog.flushForward();
    while (this.serverQueue.length) await this.serverQueue.shift()!();
  }
}

let opCounter = 0;

export class Client {
  readonly store = new ProjectStore(false);
  readonly editLog = new EditLog(this.store);
  readonly session: SharedSession;
  readonly inbox: ServerMessage[] = [];
  readonly sent: ClientMessage[] = [];
  /** Reconnect conflicts raised to the UI (the held edits clashed with a peer's). */
  readonly conflicts: { info: ConflictInfo; myState: ProjectData }[] = [];
  private deliver: (message: ServerMessage) => void = () => {};
  private reopen: () => void = () => {};
  private closed: () => void = () => {};
  /** Whether the socket is "connected": a disconnect drops outbound sends (and stops broadcasts, since
   *  the room removes the client), modelling a real network drop until `reconnect()`. */
  private connected = true;
  private readonly room: Room;
  private readonly roomClient: RoomClient = { send: (message) => this.inbox.push(message) };

  constructor(id: string, room: Room, serverQueue: Array<() => Promise<unknown>>) {
    this.room = room;
    const transport: SyncTransport = {
      send: (message) => {
        if (!this.connected) return; // dropped on the floor while disconnected
        this.sent.push(message);
        if (message.type === "subscribe") serverQueue.push(() => room.subscribe(this.roomClient));
        else if (message.type === "edit") serverQueue.push(() => room.applyIncoming(incomingEdit(message)));
      },
      onMessage: (handler) => {
        this.deliver = handler;
      },
      onOpen: (handler) => {
        this.reopen = handler;
      },
      onClose: (handler) => {
        this.closed = handler;
      },
      close: () => room.remove(this.roomClient),
    };
    this.session = new SharedSession({
      projectStore: this.store,
      editLog: this.editLog,
      transport,
      projectId: id,
      newOpId: () => `op-${opCounter++}`,
      onConflict: (info, myState) => this.conflicts.push({ info, myState }),
    });
    this.session.attach();
    this.reopen(); // initial connect fires onOpen -> the session subscribes
  }

  /** Simulate a network drop: the room stops broadcasting to us and outbound sends are lost. */
  disconnect(): void {
    this.connected = false;
    this.closed(); // the transport's onClose: the session stops sending and holds edits
    this.room.remove(this.roomClient);
    this.inbox.length = 0;
  }

  /** Simulate the socket reopening: the transport fires onOpen, so the session re-subscribes + re-sends. */
  reconnect(): void {
    this.connected = true;
    this.reopen();
  }

  /** Deliver every queued server message to the session, in receipt order. */
  flush(): void {
    while (this.inbox.length) this.deliver(this.inbox.shift()!);
  }

  /** The opId of the most recent edit this client sent (for asserting reconciliation by opId). */
  lastOpId(): string {
    const edits = this.sent.filter((message) => message.type === "edit");
    const last = edits[edits.length - 1];
    if (last?.type !== "edit") throw new Error("no edit sent");
    return last.opId;
  }

  /** Push a message straight into this client's inbox (to simulate what the authority would send). */
  receive(message: ServerMessage): void {
    this.inbox.push(message);
  }

  trackIds(): string[] {
    return this.store.snapshot().tracks.map((track) => track.id);
  }
}

// A controllable transport + an in-memory LocalMirror, to exercise the durable offline queue + confirmed
// stream in isolation (no Room needed - we drive the authority's messages by hand).
export class StubTransport implements SyncTransport {
  readonly sent: ClientMessage[] = [];
  private messageHandler: (message: ServerMessage) => void = () => {};
  private openHandler: () => void = () => {};
  private closeHandler: () => void = () => {};
  send(message: ClientMessage): void {
    this.sent.push(message);
  }
  onMessage(handler: (message: ServerMessage) => void): void {
    this.messageHandler = handler;
  }
  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  close(): void {}
  open(): void {
    this.openHandler();
  }
  drop(): void {
    this.closeHandler();
  }
  deliver(message: ServerMessage): void {
    this.messageHandler(message);
  }
}

export class FakeMirror implements LocalMirror {
  pending: PendingOp[] = [];
  readonly confirmed: EditEntry[] = [];
  constructor(private readonly initial: PendingOp[] = []) {}
  async loadPending(): Promise<PendingOp[]> {
    return this.initial;
  }
  async savePending(pending: PendingOp[]): Promise<void> {
    this.pending = [...pending];
  }
  async appendConfirmed(entry: EditEntry): Promise<void> {
    this.confirmed.push(entry);
  }
}

/** Flush the microtask + timer queue so a fire-and-forget mirror restore completes. */
export const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));
