import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeSyncEnv } from "./support/syncEnv";
import { Room, type RoomClient } from "../server/api/rooms";
import { deleteEditsBelow, listProjects } from "../server/db/store";
import { edits, files, projects } from "../server/db/schema";
import type { ServerMessage } from "../src/contract/ws";
import type { EditCommand } from "../src/audio/commands/types";
import type { ProjectData } from "../src/audio/project/types";

// A client stub that just records what the room pushes to it.
const collector = () => {
  const messages: ServerMessage[] = [];
  const client: RoomClient = { send: (message) => messages.push(message) };
  return { client, messages };
};

const createTrack = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });
const commitMarker = (message: string): EditCommand => ({ type: "commit", message }) as EditCommand;
const applied = (messages: ServerMessage[]) => messages.filter((m) => m.type === "editApplied");

// Drive `count` createTrack edits through the room (seq starts at `start`); used to cross the keyframe interval.
const fillTracks = async (room: Room, count: number, start = 0): Promise<void> => {
  for (let index = start; index < start + count; index += 1) {
    await room.applyIncoming({ command: createTrack(`t-${index}`), opId: `op-${index}` });
  }
};

const readKeyframe = async (db: Awaited<ReturnType<typeof makeSyncEnv>>["db"], projectId: string) => {
  const rows = await db
    .select({ json: files.json })
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.path, "project.json")));
  return rows[0]?.json as (ProjectData & { headSeq?: number }) | undefined;
};

// The commit-pinned keyframe written at a commit marker's seq (history/keyframes/<seq>.json).
const readCommitKeyframe = async (
  db: Awaited<ReturnType<typeof makeSyncEnv>>["db"],
  projectId: string,
  seq: number,
) => {
  const rows = await db
    .select({ json: files.json })
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.path, `history/keyframes/${seq}.json`)));
  return rows[0]?.json as (ProjectData & { headSeq?: number }) | undefined;
};

// Direct-select the surviving edit seqs (oldest first), to assert what compaction pruned vs kept.
const remainingSeqs = async (db: Awaited<ReturnType<typeof makeSyncEnv>>["db"], projectId: string) => {
  const rows = await db.select({ seq: edits.seq }).from(edits).where(eq(edits.projectId, projectId)).orderBy(edits.seq);
  return rows.map((row) => row.seq);
};

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

  it("writes a project.json keyframe once the edit interval is crossed", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    // No keyframe before the interval is reached.
    await fillTracks(room, 50);
    expect(await readKeyframe(db, "p1")).toBeUndefined();

    // Crossing KEYFRAME_INTERVAL (100 edits, seq 0..99) triggers exactly one keyframe write.
    await fillTracks(room, 50, 50);
    const keyframe = await readKeyframe(db, "p1");
    expect(keyframe?.headSeq).toBe(99);
    expect(keyframe?.tracks).toHaveLength(100);
  });

  it("reloads from the keyframe + tail, so a compacted log still reconstructs exact HEAD", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await fillTracks(room, 100); // keyframe at headSeq 99
    await fillTracks(room, 5, 100); // seq 100..104, above the keyframe

    // Simulate compaction pruning everything at/below the keyframe (the load only needs seq > headSeq).
    await deleteEditsBelow(db, "p1", 99);

    const reloaded = await Room.load(db, "local", "p1");
    expect(reloaded.snapshot()).toEqual(room.snapshot());
    expect(reloaded.snapshot().tracks).toHaveLength(105);

    // The catch-up feed still has the retained tail above the keyframe.
    const late = collector();
    await reloaded.subscribe(late.client);
    const snapshot = late.messages[0];
    expect(snapshot.type === "snapshot" && snapshot.entries.length).toBeGreaterThan(0);
  });

  it("pins a keyframe at a commit marker's seq, exact even with later edits", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await fillTracks(room, 3); // seq 0..2, three tracks
    const commit = await room.applyIncoming({ command: commitMarker("v1"), opId: "op-commit" });
    const commitSeq = commit.type === "editApplied" ? commit.seq : -1;
    expect(commitSeq).toBe(3);
    // More edits AFTER the commit: the pinned keyframe must still reflect state AT the commit's seq,
    // not the later HEAD (it was snapshotted synchronously at seq assignment).
    await fillTracks(room, 2, 4); // seq 4..5, two more tracks

    const pinned = await readCommitKeyframe(db, "p1", commitSeq);
    expect(pinned?.headSeq).toBe(commitSeq);
    expect(pinned?.tracks).toHaveLength(3); // three at the commit, not the five that exist now
    expect(room.snapshot().tracks).toHaveLength(5);
  });

  it("keeps history markers (commit + revert) through compaction, so history stays enumerable", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await fillTracks(room, 2); // seq 0..1
    await room.applyIncoming({ command: commitMarker("early"), opId: "op-commit" }); // seq 2
    await fillTracks(room, 2, 3); // seq 3..4
    // A revert (loadSnapshot) marker at seq 5, carrying a snapshot.
    const revert = { type: "loadSnapshot", project: room.snapshot(), message: 'Revert to "early"' } as EditCommand;
    await room.applyIncoming({ command: revert, opId: "op-revert" }); // seq 5
    await fillTracks(room, 2, 6); // seq 6..7

    // Prune everything at/below seq 7: fine-grained edits go, but both markers (seq 2, 5) survive.
    await deleteEditsBelow(db, "p1", 7);
    expect(await remainingSeqs(db, "p1")).toEqual([2, 5]);
  });

  it("lists a project by its renamed name without any meta.json (syncMeta retired)", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: { type: "renameProject", name: "Track Two" } as EditCommand, opId: "op-1" });

    // The listing reads projects.name (kept current by the rename edit via setProjectName), not meta.json.
    const listing = await listProjects(db, { userId: "local" });
    expect(listing.find((entry) => entry.id === "p1")?.name).toBe("Track Two");
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
