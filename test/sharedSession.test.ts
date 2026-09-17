import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { FakeMirror, Harness, settle, StubTransport } from "./support/syncHarness";
import { Room } from "../server/api/rooms";
import { readEdits } from "../server/db/store";
import { SharedSession } from "../src/audio/sync/sharedSession";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import type { EditCommand } from "../src/audio/commands/types";
import type { ServerMessage } from "../src/contract/ws";

const createTrack = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

describe("SharedSession (client optimistic + rebase)", () => {
  // (durable-mirror tests below use their own lightweight stubs; these use the full Room harness)
  it("applies a local edit optimistically and propagates it to a peer through the authority", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    const b = harness.connect("p1");
    await harness.pump(); // process the two subscribes
    a.flush(); // fold the catch-up snapshot (enables sending pending; empty here)
    b.flush();

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
    a.flush(); // fold the catch-up snapshot so pending may be sent
    b.flush();

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
    a.flush(); // fold the catch-up snapshot so pending may be sent
    b.flush();

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
    a.flush(); // fold the catch-up snapshot so pending may be sent
    b.flush();

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
    alice.flush(); // fold the catch-up snapshot so pending may be sent
    bob.flush();

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

  it("syncs a project rename to a peer (name is project state)", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1", "alice");
    const b = harness.connect("p1", "bob");
    await harness.pump();
    a.flush(); // fold the catch-up snapshot so pending may be sent
    b.flush();

    a.editLog.dispatch({ type: "renameProject", name: "Our Track" } as EditCommand);
    expect(a.store.snapshot().name).toBe("Our Track"); // optimistic on A

    await harness.pump();
    a.flush();
    b.flush();

    expect(b.store.snapshot().name).toBe("Our Track"); // propagated to the peer
    expect(harness.room.snapshot().name).toBe("Our Track"); // and the authority agrees
  });

  it("rolls back an optimistic edit the authority rejects", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const rejections: string[] = [];
    const a = harness.connect("p1");
    await harness.pump(); // fold the catch-up snapshot so the edit is sent (gets an opId to reject)
    a.flush();
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

  it("heals a disconnect: on reconnect it re-subscribes and folds edits missed while away", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1", "alice");
    const b = harness.connect("p1", "bob");
    await harness.pump();
    a.flush();
    b.flush();

    // B drops off the network; A keeps working. B is out of the room, so it misses both edits.
    b.disconnect();
    a.editLog.dispatch(createTrack("t-1"));
    a.editLog.dispatch(createTrack("t-2"));
    await harness.pump();
    a.flush();
    expect(b.trackIds()).toEqual([]);

    // B reconnects: the re-subscribe's snapshot carries the missed edits, so B catches up.
    b.reconnect();
    await harness.pump();
    b.flush();
    expect(b.trackIds()).toEqual(["t-1", "t-2"]);
    expect(a.trackIds()).toEqual(["t-1", "t-2"]);
  });

  it("re-sends an edit made while disconnected, so it reaches the authority after reconnect", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    await harness.pump();
    a.flush();

    // A goes offline, then edits: applied optimistically, but the send is dropped (never reaches the room).
    a.disconnect();
    a.editLog.dispatch(createTrack("t-a"));
    await harness.pump();
    expect(a.trackIds()).toEqual(["t-a"]); // optimistic locally
    expect(harness.room.snapshot().tracks).toHaveLength(0); // authority never saw it

    // Reconnect re-subscribes; the snapshot has no peer edits, so the held op flushes (no conflict).
    a.reconnect();
    await harness.pump(); // subscribe -> catch-up snapshot
    a.flush(); // fold snapshot -> flush the held op to the authority
    await harness.pump(); // authority applies it
    a.flush(); // adopt the echo
    expect(harness.room.snapshot().tracks.map((track) => track.id)).toEqual(["t-a"]);
    expect(a.trackIds()).toEqual(["t-a"]);
  });

  it("converges when one client deletes a note offline while another moves it", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    const b = harness.connect("p1");
    await harness.pump();
    a.flush();
    b.flush();

    // Shared: a track with one note, settled on both.
    a.editLog.dispatch(createTrack("t-1"));
    a.editLog.dispatch({
      type: "addNote",
      trackId: "t-1",
      note: { id: "n-1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
    } as EditCommand);
    await harness.pump();
    a.flush();
    b.flush();
    const noteIdsOf = (store: ProjectStore) =>
      (store.getClipStore("t-1")?.getClip().notes ?? []).map((note) => note.id).sort();
    expect(noteIdsOf(a.store)).toEqual(["n-1"]);
    expect(noteIdsOf(b.store)).toEqual(["n-1"]);

    // A goes offline and deletes the note; B (online) moves it.
    a.disconnect();
    a.editLog.dispatch({ type: "removeNotes", trackId: "t-1", ids: ["n-1"] } as EditCommand);
    b.editLog.dispatch({
      type: "editNotes",
      trackId: "t-1",
      notes: [{ id: "n-1", pitch: 64, start: 2, length: 1, velocity: 0.8 }],
    } as EditCommand);
    await harness.pump(); // B's move reaches the authority; A's delete is dropped while offline
    b.flush();

    // A reconnects: the snapshot carries B's move; both edits share author "you" here, so it is not
    // flagged as a cross-user conflict - the held delete flushes and the authority orders it last.
    a.reconnect();
    await harness.pump(); // subscribe -> catch-up snapshot (folds B's move)
    a.flush(); // fold snapshot -> flush the held delete
    b.flush();
    await harness.pump(); // authority applies the delete
    a.flush();
    b.flush();

    const roomStore = new ProjectStore(false);
    roomStore.load(harness.room.snapshot());
    // The exact winner is LWW-by-seq; what matters here is that all three replicas AGREE.
    expect(noteIdsOf(a.store)).toEqual(noteIdsOf(b.store));
    expect(noteIdsOf(roomStore)).toEqual(noteIdsOf(a.store));
  });

  it("does not double-apply an edit whose echo it missed before dropping (idempotent re-send)", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1");
    await harness.pump();
    a.flush();

    // A's edit reaches the authority (applied, seq assigned, echo queued), but A drops before flushing
    // the echo - so the op stays pending on A even though the authority already applied it.
    a.editLog.dispatch(createTrack("t-a"));
    await harness.pump();
    a.disconnect(); // clears the un-flushed echo from A's inbox
    expect(harness.room.snapshot().tracks.map((track) => track.id)).toEqual(["t-a"]);

    // Reconnect: the snapshot recovers t-a into `base`, and the re-sent op re-echoes its original seq
    // (idempotent by opId) rather than adding a second track. A converges to exactly one t-a.
    a.reconnect();
    await harness.pump(); // subscribe -> snapshot recovers t-a into base
    a.flush(); // fold snapshot -> re-send the still-pending op
    await harness.pump(); // authority re-echoes its original seq (idempotent by opId)
    a.flush(); // retire the pending op against the re-echo
    expect(a.trackIds()).toEqual(["t-a"]);
    expect(harness.room.snapshot().tracks.map((track) => track.id)).toEqual(["t-a"]);
  });

  // --- reconnect conflict flow (inc 4) ---------------------------------------
  const noteStart = (store: ProjectStore): number | undefined =>
    store
      .getClipStore("t-1")
      ?.getClip()
      .notes.find((note) => note.id === "n-1")?.start;

  /** Alice edits a note offline while Bob (a different user) edits the same note online. */
  async function stagedNoteClash() {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const alice = harness.connect("p1", "alice");
    const bob = harness.connect("p1", "bob");
    await harness.pump();
    alice.flush();
    bob.flush();

    alice.editLog.dispatch(createTrack("t-1"));
    alice.editLog.dispatch({
      type: "addNote",
      trackId: "t-1",
      note: { id: "n-1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
    } as EditCommand);
    await harness.pump();
    alice.flush();
    bob.flush();

    // Alice offline moves the note to 9; Bob online moves the same note to 5.
    alice.disconnect();
    alice.editLog.dispatch({
      type: "editNotes",
      trackId: "t-1",
      notes: [{ id: "n-1", pitch: 60, start: 9, length: 1, velocity: 0.8 }],
    } as EditCommand);
    bob.editLog.dispatch({
      type: "editNotes",
      trackId: "t-1",
      notes: [{ id: "n-1", pitch: 60, start: 5, length: 1, velocity: 0.8 }],
    } as EditCommand);
    await harness.pump();
    bob.flush();

    // Alice reconnects: the snapshot carries Bob's move, which clashes with her held move.
    alice.reconnect();
    await harness.pump();
    alice.flush();
    return { harness, alice, bob };
  }

  it("raises a conflict (not a silent merge) when a held offline edit clashes with a peer's", async () => {
    const { harness, alice } = await stagedNoteClash();

    expect(alice.conflicts).toHaveLength(1);
    expect(alice.conflicts[0].info.theirs.length).toBeGreaterThan(0);
    expect(alice.conflicts[0].info.mine.length).toBeGreaterThan(0);
    // The held edit was NOT sent: the authority still holds the peer's value, and Alice sees it too.
    const roomStore = new ProjectStore(false);
    roomStore.load(harness.room.snapshot());
    expect(noteStart(roomStore)).toBe(5); // peer's value, un-merged
    expect(noteStart(alice.store)).toBe(5); // live view shows theirs during the hold
    // The captured fork source is Alice's own optimistic state (her move to 9).
    const myState = new ProjectStore(false);
    myState.load(alice.conflicts[0].myState);
    expect(noteStart(myState)).toBe(9);
  });

  it("take theirs: discardPending drops the held edit and stays on the peer's value", async () => {
    const { harness, alice } = await stagedNoteClash();
    alice.session.discardPending();
    await harness.pump(); // nothing to send - the held edit was discarded
    const roomStore = new ProjectStore(false);
    roomStore.load(harness.room.snapshot());
    expect(noteStart(roomStore)).toBe(5);
    expect(noteStart(alice.store)).toBe(5);
  });

  it("keeps holding (does not flush) if another re-sync arrives while the dialog is open", async () => {
    const { harness, alice } = await stagedNoteClash();
    // A second reconnect (e.g. a blip) while the user is still deciding: it must NOT flush the held edit.
    alice.reconnect();
    await harness.pump();
    alice.flush();
    await harness.pump();
    alice.flush();

    expect(alice.conflicts).toHaveLength(1); // not re-raised
    const roomStore = new ProjectStore(false);
    roomStore.load(harness.room.snapshot());
    expect(noteStart(roomStore)).toBe(5); // still the peer's value; the held move never flushed
  });

  // --- commit markers: server-authoritative history foundation (B2 steps 1-2) ------
  const commitMarkers = async (db: Parameters<typeof readEdits>[0]) =>
    (await readEdits(db, { userId: "local" }, "p1", -1)).filter(
      (entry) => (entry.command as { type?: string }).type === "commit",
    );

  it("authors a commit marker into the log: held offline, gets an authoritative seq on reconnect, peers see it", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1", "alice");
    const b = harness.connect("p1", "bob");
    await harness.pump();
    a.flush();
    b.flush();

    a.disconnect();
    a.session.postCommit("first cut", "alice");
    await harness.pump();
    expect(await commitMarkers(db)).toHaveLength(0); // held offline - never reached the authority

    a.reconnect();
    await harness.pump(); // subscribe -> snapshot
    a.flush(); // fold snapshot -> flush the held marker
    await harness.pump(); // authority assigns a seq + broadcasts
    a.flush();
    b.flush();

    const markers = await commitMarkers(db);
    expect(markers).toHaveLength(1);
    expect(markers[0].seq).toBeGreaterThanOrEqual(0); // an authoritative seq, assigned by the Room
    expect((markers[0].command as { message?: string }).message).toBe("first cut");
    // The marker changes no project state (applyEdit no-ops it).
    expect(harness.room.snapshot().tracks).toHaveLength(0);
    // Peer B sees it narrated in its feed, attributed to alice.
    const bCommit = b.editLog.getEntries().find((entry) => entry.command.type === "commit");
    expect(bCommit?.author).toBe("alice");
  });

  it("two clients committing concurrently both land as distinct ordered markers (no HEAD race)", async () => {
    const { db } = await makeSyncEnv();
    const harness = new Harness(await Room.load(db, "local", "p1"));
    const a = harness.connect("p1", "alice");
    const b = harness.connect("p1", "bob");
    await harness.pump();
    a.flush();
    b.flush();

    a.session.postCommit("A version", "alice");
    b.session.postCommit("B version", "bob");
    await harness.pump();
    a.flush();
    b.flush();

    const markers = await commitMarkers(db);
    // The old shared mutable HEAD (refs.json) would have let one clobber the other; as ordered log
    // entries both survive with distinct authoritative seqs, and HEAD is simply the latest.
    expect(markers).toHaveLength(2);
    expect(new Set(markers.map((marker) => marker.seq)).size).toBe(2);
    expect(markers.map((marker) => (marker.command as { message?: string }).message).sort()).toEqual([
      "A version",
      "B version",
    ]);
  });
});

const applied = (seq: number, command: EditCommand, opId: string): ServerMessage => ({
  type: "editApplied",
  projectId: "p1",
  seq,
  command,
  author: "you",
  opId,
});

describe("SharedSession durable offline mirror", () => {
  function makeSession(mirror: FakeMirror) {
    const store = new ProjectStore(false);
    const transport = new StubTransport();
    let counter = 0;
    // One id generator for both: an edit's opId IS its log entry id (DAW-34 stage E), so a
    // predictable mint on the log is what makes the echoes below predictable. `newOpId` is left
    // wired for the edits that have no log entry of their own, like a commit marker.
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

  it("persists an enqueued op, then drains it and records the confirmed entry on the echo", async () => {
    const mirror = new FakeMirror();
    const { editLog, transport } = makeSession(mirror);
    transport.open();

    editLog.dispatch(createTrack("t-a"));
    expect(mirror.pending).toHaveLength(1); // durable before the round-trip, so a reload keeps it

    transport.deliver(applied(0, createTrack("t-a"), "op-0"));
    expect(mirror.pending).toHaveLength(0); // confirmed -> drained from the queue
    expect(mirror.confirmed.map((entry) => entry.seq)).toEqual([0]); // and appended to the offline stream
  });

  it("restores a persisted queue on load: re-applies it to the live store and re-sends it after sync", async () => {
    const mirror = new FakeMirror([{ opId: "op-x", command: createTrack("t-restored"), author: "you" }]);
    const { store, transport } = makeSession(mirror);
    transport.open();
    await settle(); // let the fire-and-forget restore run

    expect(store.snapshot().tracks.map((track) => track.id)).toEqual(["t-restored"]); // re-applied optimistically
    expect(transport.sent.some((message) => message.type === "edit")).toBe(false); // held until the catch-up snapshot

    // The catch-up snapshot (no peer edits) clears the hold; the restored op then flushes to the authority.
    transport.deliver({ type: "snapshot", projectId: "p1", headSeq: -1, entries: [] });
    expect(transport.sent.some((message) => message.type === "edit" && message.opId === "op-x")).toBe(true);
  });

  it("appends a peer's confirmed edit to the offline stream (so a reload replays it)", async () => {
    const mirror = new FakeMirror();
    const { transport } = makeSession(mirror);
    transport.open();

    // An edit we never sent (a peer's), with a fresh seq: folded into base AND mirrored for offline reload.
    transport.deliver(applied(0, createTrack("t-peer"), "op-peer"));
    expect(mirror.confirmed.map((entry) => entry.seq)).toEqual([0]);
    expect(mirror.pending).toHaveLength(0); // not ours, so nothing queued
  });
});
