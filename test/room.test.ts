import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeSyncEnv } from "./support/syncEnv";
import { Room, type RoomClient } from "../server/api/rooms";
import { projects } from "../server/db/schema";
import type { ServerMessage } from "../src/contract/ws";
import type { EditCommand } from "../src/audio/commands/types";

// A client stub that just records what the room pushes to it.
const collector = () => {
  const messages: ServerMessage[] = [];
  const client: RoomClient = { send: (message) => messages.push(message) };
  return { client, messages };
};

const createTrack = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });
const applied = (messages: ServerMessage[]) => messages.filter((m) => m.type === "editApplied");

describe("Room (realtime authority)", () => {
  it("orders two clients' edits by a single monotonic seq and broadcasts to both", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const a = collector();
    const b = collector();
    await room.subscribe(a.client);
    await room.subscribe(b.client);

    await room.applyIncoming({ command: createTrack("t-1"), opId: "op-a", author: "you" });
    await room.applyIncoming({ command: createTrack("t-2"), opId: "op-b", author: "claude" });

    // A single authoritative order, assigned 0 then 1, delivered to every peer.
    expect(applied(a.messages).map((m) => m.type === "editApplied" && m.seq)).toEqual([0, 1]);
    expect(applied(b.messages).map((m) => m.type === "editApplied" && m.seq)).toEqual([0, 1]);
    // The echo carries opId + author so the originator can retire its optimistic op.
    const first = applied(a.messages)[0];
    expect(first.type === "editApplied" && first.opId).toBe("op-a");
    expect(first.type === "editApplied" && first.author).toBe("you");
    expect(room.snapshot().tracks.map((t) => t.id)).toEqual(["t-1", "t-2"]);
  });

  it("reconstructs the same HEAD from the persisted edit stream (a fresh room)", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: createTrack("t-1"), opId: "op-1" });
    await room.applyIncoming({ command: createTrack("t-2"), opId: "op-2" });

    // A brand-new room (e.g. after an authority restart) rebuilds by replaying the edits table.
    const reloaded = await Room.load(db, "local", "p1");
    expect(reloaded.snapshot()).toEqual(room.snapshot());
  });

  it("is idempotent by opId: a resent edit re-echoes its seq without applying twice", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const first = await room.applyIncoming({ command: createTrack("t-1"), opId: "op-dup" });
    const resend = await room.applyIncoming({ command: createTrack("t-1"), opId: "op-dup" });

    expect(first.type === "editApplied" && first.seq).toBe(0);
    expect(resend.type === "editApplied" && resend.seq).toBe(0); // same seq re-echoed
    expect(room.snapshot().tracks).toHaveLength(1); // not applied twice

    // And the persisted stream has exactly one row (a fresh room agrees).
    const reloaded = await Room.load(db, "local", "p1");
    expect(reloaded.snapshot().tracks).toHaveLength(1);
  });

  it("sends a subscribing client a snapshot with the current head and recent stream", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: createTrack("t-1"), opId: "op-1" });
    await room.applyIncoming({ command: createTrack("t-2"), opId: "op-2" });

    const late = collector();
    await room.subscribe(late.client);
    const snapshot = late.messages[0];
    expect(snapshot.type).toBe("snapshot");
    if (snapshot.type === "snapshot") {
      expect(snapshot.headSeq).toBe(1);
      expect(snapshot.entries.map((e) => e.seq)).toEqual([0, 1]);
    }
  });

  it("keeps projects.name current when it applies a renameProject edit", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: { type: "renameProject", name: "My Beat" } as EditCommand, opId: "op-1" });

    // The authority mirrors the rename into the queryable index, so every collaborator's listing reflects
    // it - no dependence on the renamer pushing meta.json.
    const rows = await db.select({ name: projects.name }).from(projects).where(eq(projects.id, "p1"));
    expect(rows[0]?.name).toBe("My Beat");
  });

  it("converges on a stale-target edit (add to a just-removed track no-ops, no crash)", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: createTrack("t-1"), opId: "op-1" });
    await room.applyIncoming({ command: { type: "removeTrack", trackId: "t-1" } as EditCommand, opId: "op-2" });
    // A concurrent addNote that the authority ordered AFTER the remove: must no-op, not throw.
    await room.applyIncoming({
      command: {
        type: "addNote",
        trackId: "t-1",
        note: { id: "n-1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
      } as EditCommand,
      opId: "op-3",
    });
    expect(room.snapshot().tracks).toHaveLength(0);
  });
});
