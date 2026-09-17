/**
 * DAW-34 stage E: an undo made offline has to survive whatever happens next.
 *
 * `SharedSession` keeps the live project as `base` + `pending` and rebuilds it whenever either moves
 * - a peer's edit, a reconnect, an offline reload replaying its saved queue. A tombstone sits in
 * `pending` like any other op, but it cannot be applied forward: its `command` is the command of the
 * edit being taken back, so replaying it forward re-applies the very edit the undo removed.
 *
 * `EditLog.undo` gets the project right at the moment it is pressed, which is why nothing noticed.
 * Everything here presses undo and then makes something rebuild.
 */
import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { FakeMirror, Harness, settle, StubTransport } from "./support/syncHarness";
import { Room } from "../server/api/rooms";
import { SharedSession } from "../src/audio/sync/sharedSession";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import type { EditCommand } from "../src/audio/commands/types";
import type { ServerMessage } from "../src/contract/ws";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

const applied = (seq: number, command: EditCommand, opId: string): ServerMessage => ({
  type: "editApplied",
  projectId: "p1",
  seq,
  command,
  author: "you",
  opId,
});

/** A session over a stub socket and a fake mirror, with predictable ids. */
function makeSession(mirror: FakeMirror) {
  const store = new ProjectStore(false);
  const transport = new StubTransport();
  let counter = 0;
  // One id generator for both: an edit's opId IS its log entry id (DAW-34 stage E).
  const nextId = () => `op-${counter++}`;
  const editLog = new EditLog(store, nextId);
  const session = new SharedSession({
    projectStore: store,
    editLog,
    transport,
    projectId: "p1",
    localMirror: mirror,
    newOpId: nextId,
  });
  session.attach();
  return { store, editLog, transport, session };
}

const trackIds = (store: ProjectStore) => store.snapshot().tracks.map((each) => each.id);

describe("an undo made offline", () => {
  it("stays undone when a peer's edit rebuilds the live project", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const harness = new Harness(room);
    const author = harness.connect("p1", "alice");
    const peer = harness.connect("p1", "bob");
    await harness.pump();
    author.flush();
    peer.flush();

    author.editLog.dispatch(track("t-mine"));
    await harness.pump();
    author.flush();
    peer.flush();

    author.disconnect();
    author.editLog.undo(); // takes back t-mine; the tombstone is held, unsent
    expect(author.trackIds()).not.toContain("t-mine");

    // A peer edits while we are away. On reconnect that edit folds into `base` and the live project
    // is rebuilt from base + pending - which is where the held tombstone used to resurrect t-mine.
    peer.editLog.dispatch(track("t-theirs"));
    await harness.pump();
    peer.flush();

    author.reconnect();
    await harness.pump();
    author.flush();

    expect(author.trackIds()).toContain("t-theirs");
    expect(author.trackIds()).not.toContain("t-mine");
  });

  it("stays undone after an offline reload replays the saved queue", async () => {
    const mirror = new FakeMirror();
    const first = makeSession(mirror);
    first.transport.open();

    first.editLog.dispatch(track("t-1"));
    first.transport.deliver(applied(0, track("t-1"), "op-0")); // confirmed, so it is in `base`
    expect(trackIds(first.store)).toEqual(["t-1"]);

    // Offline: the undo is applied locally and queued.
    first.editLog.undo();
    expect(trackIds(first.store)).toEqual([]);
    const saved = mirror.pending;
    expect(saved).toHaveLength(1);
    expect(saved[0].kind).toBe("undo");

    // A reload: a fresh session restores that queue and rebuilds the live project from it.
    const reloaded = makeSession(new FakeMirror(saved));
    reloaded.editLog.dispatch(track("t-1")); // stands for the confirmed log the reload replays
    reloaded.transport.deliver(applied(0, track("t-1"), "op-0"));
    reloaded.transport.open();
    await settle();

    expect(trackIds(reloaded.store)).toEqual([]);
  });

  it("is still sent to the authority on reconnect, so the undo becomes a shared fact", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const harness = new Harness(room);
    const author = harness.connect("p1", "alice");
    await harness.pump();
    author.flush();

    author.editLog.dispatch(track("t-mine"));
    await harness.pump();
    author.flush();

    author.disconnect();
    author.editLog.undo();

    author.reconnect();
    await harness.pump(); // the re-subscribe
    author.flush(); // the snapshot, which is what flushes the held tombstone
    await harness.pump(); // and now the tombstone reaches the authority

    expect(room.snapshot().tracks.map((each) => each.id)).not.toContain("t-mine");
  });

  // Undoing an edit that has not reached the authority yet sends BOTH: the edit, then a tombstone
  // for it. Tempting to just drop the edit from the queue instead, and wrong - `pending` holds
  // unsent ops and sent-but-unacked ones alike, so dropping one the authority already had would
  // leave it holding an edit nothing would ever take back. Two log rows is the price of not
  // guessing.
  it("takes back an edit the authority never saw, by sending both", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const harness = new Harness(room);
    const author = harness.connect("p1", "alice");
    await harness.pump();
    author.flush();

    author.disconnect();
    author.editLog.dispatch(track("t-unsent"));
    author.editLog.undo();
    expect(author.trackIds()).not.toContain("t-unsent");

    author.reconnect();
    await harness.pump();
    author.flush();
    await harness.pump();
    author.flush();

    expect(room.snapshot().tracks.map((each) => each.id)).not.toContain("t-unsent");
    expect(author.trackIds()).not.toContain("t-unsent");
  });

  // Taking the peer's side at a conflict drops the whole held queue, and a tombstone in it is just
  // another unsent op: the undo goes with the edits it was sitting beside.
  it("goes with the rest of the queue when the peer's state is taken instead", async () => {
    const mirror = new FakeMirror();
    const { store, editLog, transport, session } = makeSession(mirror);
    transport.open();

    editLog.dispatch(track("t-1"));
    transport.deliver(applied(0, track("t-1"), "op-0"));
    transport.drop();
    editLog.undo();
    expect(trackIds(store)).toEqual([]);

    await session.discardPending();

    expect(mirror.pending).toEqual([]);
    expect(trackIds(store)).toEqual(["t-1"]); // back to what the authority says
  });
});
