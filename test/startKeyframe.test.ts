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
import { appendEdits, ensureUser, writeFile } from "../server/db/store";
import { KEYFRAME_INDEX_PATH } from "../src/audio/history/keyframes";
import type { Db } from "../server/db/types";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

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

    expect(await ring(db)).toEqual([-1, null, null, null, null]);
  });

  it("becomes the base the retain interval counts from", async () => {
    const { db } = await makeSyncEnv();
    await seedEdits(db, "p1", 500);
    const room = await Room.load(db, "local", "p1");
    await fill(room, 1, 500);

    expect(await ring(db)).toEqual([-1, 500, null, null, null]);
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
    // As a long-lived project looks: a head far past the retention window, and a ring of bases
    // inside it. Written straight to the log rather than driven through the room, which would be
    // two thousand transactions to establish one number.
    await appendEdits(db, { userId: "local" }, "p1", [
      { seq: 2500, id: "op-late", command: track("t-late"), author: "you", time: 0, kind: "edit" },
    ]);
    await writeFile(db, { userId: "local" }, "p1", KEYFRAME_INDEX_PATH, {
      kind: "json",
      json: [999, 1499, 1999, 2499, null],
    });

    await Room.load(db, "local", "p1");

    expect(await ring(db)).not.toContain(-1);
  });
});
