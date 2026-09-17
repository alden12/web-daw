/**
 * DAW-34 stage E: an undo reaches the authority and the peers, so it is a shared fact.
 *
 * Undo was local best-effort in a shared session: your project dropped the edit, the authority's
 * kept it, and the next thing that made the client re-derive its state from the server put the edit
 * straight back. Forwarding the tombstone is what makes everyone agree.
 */
import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { Room } from "../server/api/rooms";
import { readEdits } from "../server/db/store";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { SharedSession, type SyncTransport } from "../src/audio/sync/sharedSession";
import type { ClientMessage, ServerMessage } from "../src/contract/ws";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/** A client wired straight into a room, draining on demand so the test controls the ordering. */
function connect(room: Room, prefix: string) {
  const store = new ProjectStore(false);
  let counter = 0;
  const log = new EditLog(store, () => `${prefix}-${counter++}`);
  const inbox: ServerMessage[] = [];
  const queue: Array<() => Promise<unknown>> = [];
  let deliver: (message: ServerMessage) => void = () => {};
  let open: () => void = () => {};
  const roomClient = { send: (message: ServerMessage) => inbox.push(message) };
  const transport: SyncTransport = {
    send: (message: ClientMessage) => {
      if (message.type === "subscribe") queue.push(() => room.subscribe(roomClient));
      else if (message.type === "edit")
        queue.push(() =>
          room.applyIncoming({
            command: message.command as EditCommand,
            opId: message.opId,
            author: message.author,
            kind: message.kind,
            undoes: message.undoes,
          }),
        );
    },
    onMessage: (handler) => (deliver = handler),
    onOpen: (handler) => (open = handler),
    onClose: () => {},
    close: () => room.remove(roomClient),
  };
  const session = new SharedSession({ projectStore: store, editLog: log, transport, projectId: "p1" });
  session.attach();
  open();
  const client = {
    store,
    log,
    async pump() {
      log.flushForward(); // a test's dispatch stands for a finished gesture (DAW-8.13)
      while (queue.length) await queue.shift()!();
    },
    flush() {
      while (inbox.length) deliver(inbox.shift()!);
    },
    async ready() {
      await client.pump();
      client.flush();
    },
  };
  return client;
}

/** Both clients settled against a room holding one track each from `author`. */
async function twoClients() {
  const { db } = await makeSyncEnv();
  const room = await Room.load(db, "local", "p1");
  const author = connect(room, "a");
  const peer = connect(room, "b");
  await author.ready();
  await peer.ready();
  return { db, room, author, peer };
}

describe("an undo reaches the authority", () => {
  it("records the tombstone in the log rather than applying anything forward", async () => {
    const { db, room, author } = await twoClients();
    author.log.dispatch(track("t-1"));
    await author.pump();
    author.flush();

    author.log.undo();
    await author.pump();

    const stored = await readEdits(db, { userId: "local" }, "p1", -1);
    expect(stored.map((entry) => entry.kind)).toEqual(["edit", "undo"]);
    expect(stored[1]?.undoes).toBe("a-0");
    // And the authority's own state lost the track, which no forward apply could have done.
    expect(room.snapshot().tracks).toHaveLength(0);
  });

  it("puts it back on a redo", async () => {
    const { room, author } = await twoClients();
    author.log.dispatch(track("t-1"));
    await author.pump();
    author.flush();

    author.log.undo();
    await author.pump();
    expect(room.snapshot().tracks).toHaveLength(0);

    author.log.redo();
    await author.pump();
    expect(room.snapshot().tracks.map((each) => each.id)).toEqual(["t-1"]);
  });
});

describe("an undo reaches the peers", () => {
  it("takes the edit out of a peer's project too", async () => {
    const { author, peer } = await twoClients();
    author.log.dispatch(track("t-1"));
    await author.pump();
    author.flush();
    peer.flush();
    expect(peer.store.getTrack("t-1")).toBeTruthy();

    author.log.undo();
    await author.pump();
    peer.flush();

    expect(peer.store.getTrack("t-1")).toBeUndefined();
  });

  it("narrates it in the peer's feed, naming the edit", async () => {
    const { author, peer } = await twoClients();
    author.log.dispatch(track("t-1"));
    await author.pump();
    author.flush();
    peer.flush();

    author.log.undo();
    await author.pump();
    peer.flush();

    const marker = peer.log.getEntries().at(-1);
    expect(marker?.kind).toBe("undo");
    expect(marker?.undoes).toBe("a-0");
    expect(marker?.label).toMatch(/^Undid: /);
  });

  // The failure this guards: the peer's live project is rebuilt from base + pending, so an undo the
  // peer's own EditLog never heard of would be put straight back by its next local rebuild.
  it("does not resurrect a peer's undone edit when this client then undoes its own", async () => {
    const { author, peer } = await twoClients();
    author.log.dispatch(track("t-1"));
    await author.pump();
    author.flush();
    peer.flush();

    peer.log.dispatch(track("t-2"));
    await peer.pump();
    peer.flush();
    author.flush();

    author.log.undo(); // author takes back t-1
    await author.pump();
    peer.flush();
    expect(peer.store.getTrack("t-1")).toBeUndefined();

    peer.log.undo(); // peer takes back its own t-2
    await peer.pump();

    expect(peer.store.getTrack("t-2")).toBeUndefined();
    expect(peer.store.getTrack("t-1")).toBeUndefined(); // still gone, not resurrected
  });
});

describe("a room cold-starting honours the tombstones in its log", () => {
  it("comes back without the undone edit", async () => {
    const { db, author } = await twoClients();
    author.log.dispatch(track("t-1"));
    await author.pump();
    author.flush();
    author.log.dispatch(track("t-2"));
    await author.pump();
    author.flush();

    author.log.undo(); // takes back t-2
    await author.pump();

    // A fresh room for the same project, as an eviction and a later reconnect would produce.
    const reloaded = await Room.load(db, "local", "p1");
    expect(reloaded.snapshot().tracks.map((each) => each.id)).toEqual(["t-1"]);
  });
});
