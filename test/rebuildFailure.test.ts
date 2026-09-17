/**
 * DAW-34 stage E: what a failed rebuild must not do.
 *
 * The rebuild the authority runs for a tombstone writes nothing - the tombstone is committed to the
 * log first, in a transaction, and `recomputeHead` only reads and then swaps the in-memory store. So
 * a failure loses no data and has nothing to roll back: the log still says the edit is undone, and
 * the next rebuild or room reload reads that same log.
 *
 * What it does leave behind is a store that is BEHIND its log, still holding the undone edit. A
 * keyframe written from that store would put the undone edit into the replay floor, where only a
 * retained keyframe reaching back below it can get it out again - and the ring does not always
 * reach. So a keyframe waits for a rebuild that worked.
 */
import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeSyncEnv } from "./support/syncEnv";
import { Room } from "../server/api/rooms";
import { files } from "../server/db/schema";
import type { EditCommand } from "../src/audio/commands/types";

const readState = vi.hoisted(() => ({ failing: false }));

// The log read `recomputeHead` depends on, made to fail on demand. Everything else is the real store.
vi.mock("../server/db/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/db/store")>();
  return {
    ...actual,
    readEdits: (...args: Parameters<typeof actual.readEdits>) =>
      readState.failing ? Promise.reject(new Error("the log read failed")) : actual.readEdits(...args),
  };
});

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

const fill = async (room: Room, from: number, to: number): Promise<void> => {
  for (let index = from; index < to; index += 1) {
    await room.applyIncoming({ command: track(`t-${index}`), opId: `op-${index}` });
  }
};

const keyframeExists = async (db: Awaited<ReturnType<typeof makeSyncEnv>>["db"]): Promise<boolean> => {
  const rows = await db
    .select({ path: files.path })
    .from(files)
    .where(and(eq(files.projectId, "p1"), eq(files.path, "project.json")));
  return rows.length > 0;
};

describe("a rebuild that fails", () => {
  it("holds the keyframe back until one succeeds, rather than baking the undone edit in", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await fill(room, 0, 2);

    readState.failing = true;
    await expect(
      room.applyIncoming({ command: track("t-0"), opId: "op-undo", kind: "undo", undoes: "op-0" }),
    ).rejects.toThrow("the log read failed");

    // Well past KEYFRAME_INTERVAL, so the cadence is crossed many times over. Every one of them is
    // a chance to write a keyframe from the store that never heard the undo.
    await fill(room, 3, 110);
    expect(await keyframeExists(db)).toBe(false);

    // A rebuild that works clears it, and the very next cadence check writes the keyframe it owed.
    readState.failing = false;
    await room.applyIncoming({ command: track("t-1"), opId: "op-undo-2", kind: "undo", undoes: "op-1" });
    expect(await keyframeExists(db)).toBe(true);

    // And the keyframe reflects both undos, which is the whole point of having waited.
    const ids = room.snapshot().tracks.map((each) => each.id);
    expect(ids).not.toContain("t-0");
    expect(ids).not.toContain("t-1");
  });

  // The reachability check an undo now passes through reads the same log. A read that failed says
  // nothing about reach, and the two ways to be wrong are not equal: refusing would bounce a
  // perfectly good undo on a transient blip, while accepting leaves the tombstone for the next
  // rebuild that works to honour.
  it("does not bounce the undo just because the check could not read the log", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await fill(room, 0, 2);

    readState.failing = true;
    await expect(
      room.applyIncoming({ command: track("t-0"), opId: "op-undo", kind: "undo", undoes: "op-0" }),
    ).rejects.toThrow("the log read failed");
    readState.failing = false;

    // Recorded, not refused - so a rebuild that works still takes the edit back.
    await room.applyIncoming({ command: track("t-x"), opId: "op-x" });
    expect(room.snapshot().tracks.map((each) => each.id)).not.toContain("t-0");
  });
});
