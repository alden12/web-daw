/**
 * What a rebuild reads, now that the log is a hundred thousand edits deep (DAW-38 step 4).
 *
 * `recomputeHead` used to read the ENTIRE retained log, because a tombstone in the recent tail can
 * name an edit below the keyframe and only the whole log could say so. That was affordable at a
 * two-thousand-edit window and is not at fifty times that: every room load and every deep undo would
 * pull the lot over the wire to look at one row.
 *
 * It reads the tail instead, asks where the tail's reflog entries point, and widens only if one of
 * them really is below the base. These assert on the READS rather than the result - the result is
 * covered elsewhere, and the point here is what it costs to arrive at it.
 */
import { describe, expect, it, vi } from "vitest";
import { makeSyncEnv, seedEdits } from "./support/syncEnv";
import { Room } from "../server/api/rooms";
import { ProjectStore } from "../src/audio/project/projectStore";
import type { Db } from "../server/db/types";
import type { EditCommand } from "../src/audio/commands/types";

const reads = vi.hoisted(() => ({ from: [] as { since: number; limited: boolean }[] }));

vi.mock("../server/db/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/db/store")>();
  return {
    ...actual,
    readEdits: (...args: Parameters<typeof actual.readEdits>) => {
      reads.from.push({ since: args[3], limited: args[4] !== undefined });
      return actual.readEdits(...args);
    },
  };
});

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/** A project with a head keyframe partway up its log, which is what any project past its first
 *  hundred edits looks like. */
async function projectWithKeyframeAt(db: Db, keyframeSeq: number, logLength: number) {
  await seedEdits(db, "p1", logLength);
  const { writeFile } = await import("../server/db/store");
  await writeFile(db, { userId: "local" }, "p1", "project.json", {
    kind: "json",
    json: { ...new ProjectStore(false).snapshot(), headSeq: keyframeSeq },
  });
}

/** Reads with no floor and no limit: the ones that pull every retained row. */
const fullReads = () => reads.from.filter((read) => read.since === -1 && !read.limited);

describe("what a room rebuild reads", () => {
  it("reads the tail above the keyframe, not the whole log", async () => {
    const { db } = await makeSyncEnv();
    await projectWithKeyframeAt(db, 99, 200);
    reads.from = [];

    await Room.load(db, "local", "p1");

    expect(reads.from.some((read) => read.since === 99)).toBe(true);
    expect(fullReads()).toEqual([]);
  });

  it("stays on the tail for an undo of a recent edit, which is nearly all of them", async () => {
    const { db } = await makeSyncEnv();
    await projectWithKeyframeAt(db, 99, 200);
    const room = await Room.load(db, "local", "p1");
    reads.from = [];

    // Above the keyframe: the rebuild replays it anyway, and the reach check no longer needs the log
    // to know that - it asks where `seed-190` sits and gets one row back.
    await room.applyIncoming({ command: track("t"), opId: "u-1", kind: "undo", undoes: "seed-190" });

    expect(reads.from.length).toBeGreaterThan(0);
    expect(reads.from.every((read) => read.since >= 99)).toBe(true);
  });

  it("widens exactly once when a tombstone names an edit below the keyframe", async () => {
    const { db } = await makeSyncEnv();
    await projectWithKeyframeAt(db, 99, 200);
    const room = await Room.load(db, "local", "p1");
    reads.from = [];

    // Below the keyframe, so the tail cannot settle it and the rebuild drops to the base at the
    // project's start - which does mean reading from the beginning. Once, though: the reach check
    // used to read the whole log too, for the sake of one row.
    await room.applyIncoming({ command: track("t"), opId: "u-1", kind: "undo", undoes: "seed-5" });

    expect(fullReads()).toHaveLength(1);
  });
});
