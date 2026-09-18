/**
 * DAW-34 stage E: a hosted project keeps a rebuild base at its start.
 *
 * The oldest base a room had was its first keyframe, written 100 edits in, so nothing sat below
 * edits 0..99 and no rebuild could leave one of them out. Online that showed as undo greyed out for
 * the project's first edits; offline, where a client's cached ring is more generous than the
 * authority's current one, it showed as the undo being refused on reconnect.
 *
 * A local project has always retained one at seq -1 on its first save. This is the same thing for a
 * room.
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeSyncEnv, seedEdits } from "./support/syncEnv";
import { Harness } from "./support/syncHarness";
import { Room } from "../server/api/rooms";
import { files } from "../server/db/schema";
import { appendEdits, ensureUser, readEdits, writeFile } from "../server/db/store";
import { KEYFRAME_INDEX_PATH, KEYFRAME_RING_SIZE } from "../src/audio/history/keyframes";
import type { Db } from "../server/db/types";
import type { EditCommand } from "../src/audio/commands/types";
import type { ServerMessage } from "../src/contract/ws";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/** The ring as `[...slots]` padded to its full length, so a test can write only the slots it means. */
const slots = (...used: (number | null)[]): (number | null)[] =>
  Array.from({ length: KEYFRAME_RING_SIZE }, (_, slot) => used[slot] ?? null);

const ring = async (db: Db): Promise<(number | null)[]> => {
  const rows = await db
    .select({ json: files.json })
    .from(files)
    .where(and(eq(files.projectId, "p1"), eq(files.path, KEYFRAME_INDEX_PATH)));
  return (rows[0]?.json ?? []) as (number | null)[];
};

const fill = async (room: Room, count: number, from = 0): Promise<void> => {
  for (let index = from; index < from + count; index += 1) {
    await room.applyIncoming({ command: track(`bg-${index}`), opId: `bg-${index}` });
  }
};

describe("a room's start keyframe", () => {
  it("is retained as soon as the room exists", async () => {
    const { db } = await makeSyncEnv();
    await Room.load(db, "local", "p1");

    expect(await ring(db)).toContain(-1);
  });

  // The retain interval measures from the newest base, so seeding the start also moves the cadence:
  // the next slot is taken 500 edits after the START rather than 500 after the first keyframe. Same
  // spacing, one base earlier, and the project's opening edits covered instead of stranded.
  it("holds the only slot until the interval has elapsed from it", async () => {
    const { db } = await makeSyncEnv();
    await seedEdits(db, "p1", 120);
    const room = await Room.load(db, "local", "p1");
    await fill(room, 1, 120); // crosses the keyframe interval, but not the retain one

    expect(await ring(db)).toEqual(slots(-1));
  });

  it("becomes the base the retain interval counts from", async () => {
    const { db } = await makeSyncEnv();
    await seedEdits(db, "p1", 500);
    const room = await Room.load(db, "local", "p1");
    await fill(room, 1, 500);

    expect(await ring(db)).toEqual(slots(-1, 500));
  });

  // The case that sent me looking: a client's own first edit, undone after the project moved past
  // the first keyframe. It used to be refused because nothing sat below it.
  it("makes an edit from the project's first window undoable", async () => {
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
    await fill(room, 120);

    author.editLog.undo();
    author.reconnect();
    await harness.pump();
    author.flush();
    await harness.pump();
    author.flush();

    expect(author.errors).toEqual([]);
    expect(room.snapshot().tracks.map((each) => each.id)).not.toContain("t-mine");
    expect(author.trackIds()).not.toContain("t-mine");
  });

  it("is added to an existing project that never got one", async () => {
    const { db } = await makeSyncEnv();
    const first = await Room.load(db, "local", "p1");
    await fill(first, 120);
    // Wipe the start base, as a project written before this existed would have.
    await db
      .update(files)
      .set({ json: [99, null, null, null, null] })
      .where(and(eq(files.projectId, "p1"), eq(files.path, KEYFRAME_INDEX_PATH)));

    await Room.load(db, "local", "p1"); // an eviction and a later reconnect

    expect(await ring(db)).toEqual(expect.arrayContaining([-1, 99]));
  });

  it("is not written twice when a room is reloaded", async () => {
    const { db } = await makeSyncEnv();
    await Room.load(db, "local", "p1");
    await Room.load(db, "local", "p1");

    expect((await ring(db)).filter((seq) => seq === -1)).toHaveLength(1);
  });

  // Past the retention window the log no longer reaches seq 0, so replaying from the start would
  // arrive nowhere - which `rebuildBase`'s own floor already refuses. No point storing it.
  it("is not offered to a project whose log has moved past the window", async () => {
    const { db } = await makeSyncEnv();
    await ensureUser(db, "local");
    // As a very long-lived project looks: a head past `RETAINED_EDITS` (DAW-38), so compaction has
    // taken seq 0 with it, and a ring of bases inside what is left. Written straight to the log
    // rather than driven through the room, which would be a hundred thousand transactions to
    // establish one number.
    await appendEdits(db, { userId: "local" }, "p1", [
      { seq: 150_000, id: "op-late", command: track("t-late"), author: "you", time: 0, kind: "edit" },
    ]);
    await writeFile(db, { userId: "local" }, "p1", KEYFRAME_INDEX_PATH, {
      kind: "json",
      json: [100_000, 120_000, 140_000, 149_000, null],
    });

    await Room.load(db, "local", "p1");

    expect(await ring(db)).not.toContain(-1);
  });
});

/**
 * DAW-38: the authority keeps far more log than it puts on the wire.
 *
 * One constant used to do both jobs, and raising it for retention would have sent a project's entire
 * history to every client that connected. These say the two are separate, in the only terms that
 * matter: how much a subscriber receives, and how much survives compaction.
 */
describe("what the authority keeps against what it sends", () => {
  it("sends a joining client a bounded catch-up feed, not the whole log", async () => {
    const { db } = await makeSyncEnv();
    await seedEdits(db, "p1", 2500);
    const room = await Room.load(db, "local", "p1");
    const received: ServerMessage[] = [];
    await room.subscribe({ send: (message) => received.push(message) });

    const snapshot = received.find((message) => message.type === "snapshot");
    expect(snapshot?.type === "snapshot" && snapshot.entries).toHaveLength(2000);
    expect(snapshot?.type === "snapshot" && snapshot.headSeq).toBe(2499);
  });

  it("keeps the log well past that, so the start of the project is still replayable", async () => {
    const { db } = await makeSyncEnv();
    await seedEdits(db, "p1", 2500);
    const room = await Room.load(db, "local", "p1");
    await fill(room, 1, 2500); // crosses the keyframe interval, so compaction runs

    // Every seed edit is still there: the prune floor follows RETAINED_EDITS, not the feed window.
    const log = await readEdits(db, { userId: "local" }, "p1", -1);
    expect(log).toHaveLength(2501);
    expect(log[0].seq).toBe(0);
  });

  // The pair the log cap exists for: a project whose keyframe is gone rebuilds from its start.
  it("rebuilds a project from its start when the head keyframe is unusable", async () => {
    const { db } = await makeSyncEnv();
    await seedEdits(db, "p1", 2500);
    const room = await Room.load(db, "local", "p1");
    await fill(room, 1, 2500);
    const before = room.snapshot().tracks.length;

    // The head keyframe goes; only the log and the start base are left to work from.
    await db.delete(files).where(and(eq(files.projectId, "p1"), eq(files.path, "project.json")));

    const recovered = await Room.load(db, "local", "p1");
    expect(recovered.snapshot().tracks).toHaveLength(before);
  });
});
