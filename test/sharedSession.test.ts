import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { Room, type RoomClient } from "../server/api/rooms";
import { SharedSession, type SyncTransport } from "../src/audio/sync/sharedSession";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import type { EditCommand } from "../src/audio/commands/types";
import type { ClientMessage, ServerMessage } from "../src/contract/ws";

// A deterministic, fully controllable transport harness. Client -> server messages queue on a shared
// `serverQueue` (drained by `pump()` in enqueue order, so the test picks who reaches the authority
// first); server -> client messages queue in each client's `inbox` (drained by `flush()`), so the test
// controls the order a client observes edits. This reproduces the rebase-over-pending case: a peer's
// edit reaching a client while its own edit is still unconfirmed.
class Harness {
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

  /** Drain queued client -> server operations (subscribe / edit) in enqueue order. */
  async pump(): Promise<void> {
    while (this.serverQueue.length) await this.serverQueue.shift()!();
  }
}

let opCounter = 0;

class Client {
  readonly store = new ProjectStore(false);
  readonly editLog = new EditLog(this.store);
  readonly session: SharedSession;
  readonly inbox: ServerMessage[] = [];
  readonly sent: ClientMessage[] = [];
  private deliver: (message: ServerMessage) => void = () => {};
  private readonly roomClient: RoomClient = { send: (message) => this.inbox.push(message) };

  constructor(id: string, room: Room, serverQueue: Array<() => Promise<unknown>>) {
    const transport: SyncTransport = {
      send: (message) => {
        this.sent.push(message);
        if (message.type === "subscribe") serverQueue.push(() => room.subscribe(this.roomClient));
        else if (message.type === "edit")
          serverQueue.push(() =>
            room.applyIncoming({ command: message.command as EditCommand, opId: message.opId, author: message.author }),
          );
      },
      onMessage: (handler) => {
        this.deliver = handler;
      },
      close: () => room.remove(this.roomClient),
    };
    this.session = new SharedSession({
      projectStore: this.store,
      editLog: this.editLog,
      transport,
      projectId: id,
      newOpId: () => `op-${opCounter++}`,
    });
    this.session.attach();
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

const createTrack = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

describe("SharedSession (client optimistic + rebase)", () => {
  it("applies a local edit optimistically and propagates it to a peer through the authority", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    const b = harness.connect("p1");
    await harness.pump(); // process the two subscribes

    a.editLog.dispatch(createTrack("t-a"));
    // Optimistic: A sees its track before the round-trip; B has not heard yet.
    expect(a.trackIds()).toEqual(["t-a"]);
    expect(b.trackIds()).toEqual([]);

    await harness.pump(); // authority orders + broadcasts
    a.flush();
    b.flush();

    expect(a.trackIds()).toEqual(["t-a"]);
    expect(b.trackIds()).toEqual(["t-a"]);
    expect(harness.room.snapshot().tracks.map((track) => track.id)).toEqual(["t-a"]);
  });

  it("rebases a pending local edit beneath a peer edit that the authority ordered first", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    const b = harness.connect("p1");
    await harness.pump();

    // B reaches the authority first (seq 0), A second (seq 1) - both applied locally first.
    b.editLog.dispatch(createTrack("t-b"));
    a.editLog.dispatch(createTrack("t-a"));
    expect(a.trackIds()).toEqual(["t-a"]); // A's optimistic view (its own edit only)

    await harness.pump(); // seq 0 = t-b, seq 1 = t-a

    // A observes the peer's edit (seq 0) while its own (seq 1) is still pending -> it rebases, replaying
    // t-a on top of t-b, then adopts its own confirmation.
    a.flush();
    b.flush();

    expect(a.trackIds()).toEqual(["t-b", "t-a"]);
    expect(b.trackIds()).toEqual(["t-b", "t-a"]);
    expect(harness.room.snapshot().tracks.map((track) => track.id)).toEqual(["t-b", "t-a"]);
  });

  it("converges when a peer edit targets an object this client just removed (stale-target no-op)", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    const b = harness.connect("p1");
    await harness.pump();

    // Seed a shared track (seq 0) and let it settle everywhere.
    a.editLog.dispatch(createTrack("t-1"));
    await harness.pump();
    a.flush();
    b.flush();

    // A removes the track; B concurrently adds a note to it. A's remove is ordered first.
    a.editLog.dispatch({ type: "removeTrack", trackId: "t-1" } as EditCommand);
    b.editLog.dispatch({
      type: "addNote",
      trackId: "t-1",
      note: { id: "n-1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
    } as EditCommand);
    await harness.pump();
    a.flush();
    b.flush();

    // The addNote sequenced after the remove no-ops; both converge to no tracks.
    expect(a.trackIds()).toEqual([]);
    expect(b.trackIds()).toEqual([]);
    expect(harness.room.snapshot().tracks).toHaveLength(0);
  });

  it("ignores a duplicate editApplied (idempotent by seq, so a redelivery does not double-apply)", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    const b = harness.connect("p1");
    await harness.pump();

    a.editLog.dispatch(createTrack("t-1"));
    await harness.pump();
    a.flush();

    // Redeliver B's snapshot + the same editApplied twice: the second is below head and is dropped.
    const applied = b.inbox.find((message) => message.type === "editApplied");
    b.flush();
    if (applied) b.receive(applied);
    b.flush();

    expect(b.trackIds()).toEqual(["t-1"]); // exactly once
  });

  it("narrates a peer's edit in the recipient's feed, attributed to that user, without double-recording own edits", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const alice = harness.connect("p1", "alice");
    const bob = harness.connect("p1", "bob");
    await harness.pump();

    alice.editLog.dispatch(createTrack("t-a"));
    await harness.pump();
    alice.flush();
    bob.flush();

    // Alice made one edit: it appears once in her feed (from dispatch), authored by her.
    const aliceEdits = alice.editLog.getEntries().filter((entry) => entry.kind === "edit");
    expect(aliceEdits).toHaveLength(1);
    expect(aliceEdits[0].author).toBe("alice");

    // Bob never made an edit, but Alice's arrives in his feed attributed to "alice".
    const bobEdits = bob.editLog.getEntries().filter((entry) => entry.kind === "edit");
    expect(bobEdits).toHaveLength(1);
    expect(bobEdits[0].author).toBe("alice");
  });

  it("rolls back an optimistic edit the authority rejects", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const rejections: string[] = [];
    const a = harness.connect("p1");
    // Route the session's error surface through a spy by re-attaching with an onError is not exposed;
    // instead assert the state rollback (the observable effect of a rejection).

    a.editLog.dispatch(createTrack("t-x"));
    expect(a.trackIds()).toEqual(["t-x"]); // optimistic

    // The authority refuses it: deliver an editRejected for the pending op. The client drops the
    // optimistic op and rebuilds without it (never reaching the authority's store).
    a.receive({ type: "editRejected", opId: a.lastOpId(), reason: "forbidden" });
    a.flush();

    expect(a.trackIds()).toEqual([]);
    void rejections;
  });
});
