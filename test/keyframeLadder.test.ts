/**
 * How far back the authority can still take an edit out (DAW-38).
 *
 * The ring, not the log, decides that: a rebuild needs a base from BELOW the edit being undone, so
 * an edit with no keyframe under it is refused however much log survives. Evenly-spaced slots gave a
 * fixed reach of `KEYFRAME_RING_SIZE * KEYFRAME_RETAIN_INTERVAL` and no more, which is the shape that
 * fails the case this is all for: someone offline for a flight comes back to a head that has moved
 * thousands of edits, and finds their own steps no longer undoable.
 *
 * Evicting the most redundant rung instead leaves a geometric ladder whose oldest rung stays put.
 */
import { describe, expect, it } from "vitest";
import { makeSyncEnv, seedEdits } from "./support/syncEnv";
import { Room } from "../server/api/rooms";
import { writeFile } from "../server/db/store";
import { KEYFRAME_INDEX_PATH, KEYFRAME_RING_SIZE, retainedKeyframePath } from "../src/audio/history/keyframes";
import { ProjectStore } from "../src/audio/project/projectStore";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/**
 * A project whose ring has turned over: a long log, and a ladder of the shape eviction settles into.
 *
 * The index is written directly rather than grown edit by edit. Growing it drives `Room.load` once
 * per rung, and each load re-reads and replays the whole log, so the honest version of this test
 * spent 4.8 seconds arriving at an index this states in one line. What eviction produces is
 * `keyframes.test.ts`'s job; what a turned-over ring can still reach is this one's.
 */
async function projectWithLadder(rungs: readonly number[]) {
  const { db } = await makeSyncEnv();
  await seedEdits(db, "p1", HEAD + 1);
  // The keyframe each rung points at. Only the oldest is read here, but a ring whose index names
  // files that do not exist is not the ring this is testing.
  for (const [slot, seq] of rungs.entries()) {
    await writeFile(db, { userId: "local" }, "p1", retainedKeyframePath(slot), {
      kind: "json",
      json: { ...new ProjectStore(false).snapshot(), headSeq: seq },
    });
  }
  await writeFile(db, { userId: "local" }, "p1", KEYFRAME_INDEX_PATH, {
    kind: "json",
    json: Array.from({ length: KEYFRAME_RING_SIZE }, (_, slot) => rungs[slot] ?? null),
  });
  // A head keyframe at the top of the log, which is what any project of this age has. Its `headSeq`
  // is the part that matters: without one the replay floor is -1, every edit is above it, and the
  // room accepts an undo without ever asking the ring - so the question this test asks would not be
  // asked. The snapshot itself is never read here; `canHonourUndo` compares seqs.
  await writeFile(db, { userId: "local" }, "p1", "project.json", {
    kind: "json",
    json: { ...new ProjectStore(false).snapshot(), headSeq: HEAD },
  });
  return { db, room: await Room.load(db, "local", "p1") };
}

/**
 * Deliberately small. Nothing here scales with the log's length - the ring is stated rather than
 * grown - so a longer one only buys replay time, and the six-thousand-edit version of this timed out
 * in CI while passing locally. What the test needs is a ring with every slot taken and rungs spread
 * across the project, which these proportions give just as well.
 */
const HEAD = 150;
/**
 * What the eviction rule settles into by this depth: dense near head, doubling back to the project's
 * start. Every slot is taken, which is also what makes the negative case below reachable - a ring
 * with a free slot gets a start keyframe seeded into it on load (`seedStartKeyframe`), and would
 * answer the deep undo from that instead.
 */
const LADDER = [-1, HEAD - 140, HEAD - 125, HEAD - 105, HEAD - 80, HEAD - 55, HEAD - 35, HEAD - 20, HEAD - 5] as const;

/** The same ladder with its oldest rung raised above the edit under test: the old fixed reach. */
const SHALLOW_LADDER = [8, ...LADDER.slice(1)] as const;

describe("undo reach, after the ring has turned over", () => {
  it("still honours an undo from the start of the project", async () => {
    const { room } = await projectWithLadder(LADDER);

    const reply = await room.applyIncoming({
      command: track("seeded"),
      opId: "u-1",
      kind: "undo",
      undoes: "seed-5",
    });

    expect(reply.type).toBe("editApplied");
  });

  // The same ladder minus its oldest rung, which is what evicting the OLDEST slot used to leave: a
  // reach of ring size times interval and no further, so an edit from the project's start is gone.
  it("refuses that same undo when the ladder has no rung below it", async () => {
    const { room } = await projectWithLadder(SHALLOW_LADDER);

    const reply = await room.applyIncoming({
      command: track("seeded"),
      opId: "u-1",
      kind: "undo",
      undoes: "seed-5",
    });

    expect(reply.type).toBe("editRejected");
  });

  it("still honours an undo of something recent, which is the common case", async () => {
    const { room } = await projectWithLadder(LADDER);
    const recent = await room.applyIncoming({ command: track("t-recent"), opId: "e-recent" });
    expect(recent.type).toBe("editApplied");

    const reply = await room.applyIncoming({
      command: track("t-recent"),
      opId: "u-2",
      kind: "undo",
      undoes: "e-recent",
    });

    expect(reply.type).toBe("editApplied");
    expect(room.snapshot().tracks.map((each) => each.id)).not.toContain("t-recent");
  });
});
