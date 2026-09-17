/**
 * DAW-34 stage E: an undo step names an edit, not a position in a queue.
 *
 * `seq` is an ORDER, and in a hosted session it is the authority's to assign: the client numbers
 * its own entries optimistically and the authority renumbers them. A stack written against client
 * seqs therefore named nothing once the log came back from the server, so the whole stack was
 * dropped on reload and undo-across-reload was simply unavailable in a shared session.
 *
 * An entry now carries an `id`, minted by whoever made the edit and never reassigned. It is the
 * same value as the `opId` the edit is forwarded under, so the client's log, the authority's log,
 * and every peer's feed all name the edit the same way.
 */
import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { incomingEdit, Room } from "../server/api/rooms";
import { readEdits } from "../server/db/store";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { SharedSession, type SyncTransport } from "../src/audio/sync/sharedSession";
import { rebuildWithout } from "../src/audio/commands/replay";
import type { ClientMessage, ServerMessage } from "../src/contract/ws";
import type { EditCommand, EditEntry } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/** A log with a predictable id mint, so an assertion can name an entry without a uuid in it. */
function seededLog() {
  const project = new ProjectStore(false);
  let counter = 0;
  const log = new EditLog(project, () => `e-${counter++}`);
  return { project, log };
}

describe("an entry's id, not its seq, is its identity", () => {
  it("stamps every dispatched edit with one", () => {
    const { log } = seededLog();
    log.dispatch(track("t-1"));
    log.dispatch({ type: "setTempo", bpm: 140 });

    expect(log.getEntries().map((entry) => entry.id)).toEqual(["e-0", "e-1"]);
  });

  it("keeps the id of the entry a gesture folds into, so the drag stays one step", () => {
    const { log } = seededLog();
    log.beginGesture();
    for (const bpm of [120, 130, 140]) log.dispatch({ type: "setTempo", bpm });
    log.endGesture();

    expect(log.getEntries().map((entry) => entry.id)).toEqual(["e-0"]);
    expect(log.getCheckpoints().undo).toEqual(["e-0"]);
  });

  it("names the entry in the undo stack, so the stack says nothing about order", () => {
    const { log } = seededLog();
    log.dispatch(track("t-1"));
    log.dispatch({ type: "setTempo", bpm: 140 });
    log.undo();

    expect(log.getCheckpoints()).toEqual({ undo: ["e-0"], redo: ["e-1"] });
  });
});

/**
 * The regression this stage exists to close. The authority's seqs have nothing to do with the
 * client's, so the reload below hands the log back renumbered - which is exactly what a hosted
 * reload does - and the stack has to survive it.
 */
describe("undo survives the authority renumbering the log", () => {
  /** The same entries as the authority would hand them back: same ids, its own seqs. */
  const renumbered = (entries: readonly EditEntry[], from: number): EditEntry[] =>
    entries.map((entry, index) => ({ ...entry, seq: from + index }));

  it("takes back the right edit after a reload that renumbered every entry", () => {
    const { project, log } = seededLog();
    log.dispatch(track("t-1"));
    log.resetCoalescing();
    log.dispatch({ type: "setTempo", bpm: 140 });
    const stack = log.getCheckpoints();
    expect(project.tempo).toBe(140);

    // Reload: a fresh store and log, fed the authority's version of the same edits.
    const reloaded = new ProjectStore(false);
    const reloadedLog = new EditLog(reloaded);
    const entries = renumbered(log.getEntries(), 500);
    reloaded.load(project.snapshot());
    reloadedLog.restore(entries);
    reloadedLog.setRebuildBase(new ProjectStore(false).snapshot(), 499);
    reloadedLog.restoreCheckpoints(stack);

    expect(reloadedLog.getState().canUndo).toBe(true);
    reloadedLog.undo();
    // The tempo edit came back out, and the track edit - a different entry - did not.
    expect(reloaded.tempo).toBe(120);
    expect(reloaded.getTrack("t-1")).toBeTruthy();
  });

  it("drops only the steps the renumbered log does not hold, not the whole stack", () => {
    const { log } = seededLog();
    log.dispatch(track("t-1"));
    log.resetCoalescing();
    log.dispatch({ type: "setTempo", bpm: 140 });
    const stack = log.getCheckpoints();

    // The authority pruned the older edit, so only the tempo entry comes back.
    const reloadedLog = new EditLog(new ProjectStore(false));
    reloadedLog.restore(renumbered(log.getEntries().slice(1), 900));
    reloadedLog.setRebuildBase(new ProjectStore(false).snapshot(), 899);
    reloadedLog.restoreCheckpoints(stack);

    expect(reloadedLog.getCheckpoints().undo).toEqual(["e-1"]);
  });
});

/**
 * A shared session's project is written by the authority, not by this client, and an undo is not
 * forwarded to it - so the log comes back on reload with the undone edit still applied. Restoring
 * the stacks used to assume the loaded project already reflected them, which is true only of a
 * project the local autosave wrote.
 */
describe("a restored stack is made true, not assumed true", () => {
  /** The state the authority would hand back: every edit applied, no exclusions. */
  const asAuthority = (entries: readonly EditEntry[]): ProjectStore => {
    const store = new ProjectStore(false);
    store.load(rebuildWithout(new ProjectStore(false).snapshot(), -1, entries, new Set()));
    return store;
  };

  /** Three edits with the last one undone, plus the log the authority would hold. */
  const undoneThenReloaded = () => {
    const { log } = seededLog();
    log.dispatch(track("t-1"));
    log.resetCoalescing();
    log.dispatch(track("t-2"));
    log.resetCoalescing();
    log.dispatch({ type: "setTempo", bpm: 140 });
    log.undo(); // takes back the tempo edit, locally: nothing is forwarded

    const stack = log.getCheckpoints();
    const entries = log.getEntries().filter((entry) => entry.kind === "edit");
    const reloaded = asAuthority(entries);
    const reloadedLog = new EditLog(reloaded);
    reloadedLog.restore(entries);
    reloadedLog.setRebuildBase(new ProjectStore(false).snapshot(), -1);
    reloadedLog.restoreCheckpoints(stack);
    return { reloaded, reloadedLog, stack };
  };

  it("applies what was undone before the reload, rather than trusting the loaded project", () => {
    const { reloaded, stack } = undoneThenReloaded();

    expect(stack.redo).toHaveLength(1);
    // The authority's copy had 140 in it, because it never heard about the undo.
    expect(reloaded.tempoBpm).toBe(120);
  });

  // The bug this closes: one press of undo took back two edits, the one pressed and the one undone
  // before the reload, because the excluded set was believed rather than applied. So the assertion
  // has to be about the CHANGE the press made - a test that only reads the state afterwards passes
  // either way, since the bug and the fix agree on where it ends up.
  it("takes back exactly one edit when undo is pressed after such a reload", () => {
    const { reloaded, reloadedLog } = undoneThenReloaded();
    const before = reloaded.snapshot();

    reloadedLog.undo(); // the user takes back t-2, and only t-2
    const after = reloaded.snapshot();

    expect(after.tracks.map((each) => each.id)).toEqual(
      before.tracks.filter((each) => each.id !== "t-2").map((each) => each.id),
    );
    // The tempo edit was already undone before the press, so the press must not move it.
    expect(after.tempoBpm).toBe(before.tempoBpm);
  });

  it("puts the pre-reload edit back on redo, so nothing is stranded", () => {
    const { reloaded, reloadedLog } = undoneThenReloaded();

    expect(reloadedLog.getState().canRedo).toBe(true);
    reloadedLog.redo();
    expect(reloaded.tempoBpm).toBe(140);
  });
});

describe("the authority stores the identity the client minted", () => {
  /** A transport wired straight into a room, draining synchronously on demand. */
  function connect(room: Room) {
    const store = new ProjectStore(false);
    let counter = 0;
    const log = new EditLog(store, () => `e-${counter++}`);
    const inbox: ServerMessage[] = [];
    const queue: Array<() => Promise<unknown>> = [];
    let deliver: (message: ServerMessage) => void = () => {};
    let open: () => void = () => {};
    const roomClient = { send: (message: ServerMessage) => inbox.push(message) };
    const transport: SyncTransport = {
      send: (message: ClientMessage) => {
        if (message.type === "subscribe") queue.push(() => room.subscribe(roomClient));
        else if (message.type === "edit") queue.push(() => room.applyIncoming(incomingEdit(message), roomClient));
      },
      onMessage: (handler) => (deliver = handler),
      onOpen: (handler) => (open = handler),
      onClose: () => {},
      close: () => room.remove(roomClient),
    };
    const session = new SharedSession({ projectStore: store, editLog: log, transport, projectId: "p1" });
    session.attach();
    open();
    const harness = {
      store,
      log,
      async pump() {
        log.flushForward(); // a test's dispatch stands for a finished gesture (DAW-8.13)
        while (queue.length) await queue.shift()!();
      },
      flush() {
        while (inbox.length) deliver(inbox.shift()!);
      },
      /** Settle the subscribe. The session holds edits until it has folded the catch-up snapshot,
       *  so without this every dispatch below would sit in `pending` unsent. */
      async ready() {
        await harness.pump();
        harness.flush();
      },
    };
    return harness;
  }

  it("persists the client's entry id as the edit's id, under its own seq", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const client = connect(room);
    await client.ready();

    client.log.dispatch(track("t-1"));
    await client.pump();

    const stored = await readEdits(db, { userId: "local" }, "p1", -1);
    expect(stored.map((entry) => entry.id)).toEqual(["e-0"]);
    // The authority's own order, which is not the client's and does not have to be.
    expect(stored.map((entry) => entry.seq)).toEqual([0]);
  });

  it("gives a peer the id of the edit, so it can name an edit it did not make", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const author = connect(room);
    const peer = connect(room);
    await author.ready();
    await peer.ready();

    author.log.dispatch(track("t-1"));
    await author.pump();
    peer.flush();

    expect(peer.log.getEntries().map((entry) => entry.id)).toEqual(["e-0"]);
    expect(peer.store.getTrack("t-1")).toBeTruthy();
  });

  it("folds a whole drag into one authoritative row, under one id", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const client = connect(room);
    await client.ready();

    client.log.beginGesture();
    for (const bpm of [120, 130, 141]) client.log.dispatch({ type: "setTempo", bpm });
    client.log.endGesture();
    await client.pump();

    const stored = await readEdits(db, { userId: "local" }, "p1", -1);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe("e-0");
    expect(room.snapshot().tempoBpm).toBe(141);
  });
});
