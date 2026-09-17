/**
 * DAW-34 stage E: an undo the authority cannot honour is refused, not recorded.
 *
 * Raised by Alden: what if a client undoes offline, and by the time it reconnects the edit it took
 * back sits below the authority's keyframe with no older retained one to drop to?
 *
 * It used to be accepted and then quietly do nothing. The tombstone went into the log, the rebuild
 * could not reach the edit, so the authority kept it - while the client that pressed undo had
 * already dropped it. Two different projects, no error, and it lasted as long as the tab did.
 *
 * Refusing it converges them instead: the client puts the edit back and says so. The same
 * "unavailable rather than wrong" call every other rebuild path makes with no base to reach from.
 */
import { describe, expect, it } from "vitest";
import { makeSyncEnv } from "./support/syncEnv";
import { Harness } from "./support/syncHarness";
import { Room } from "../server/api/rooms";
import { deleteEditsBelow, readEdits } from "../server/db/store";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/**
 * A client whose own edit has been left behind by the authority: the project moved on while it was
 * away, and compaction then pruned that edit out of the retained log altogether. With no entry left
 * there is nothing for a rebuild to leave out, however far back the bases reach.
 *
 * Compaction is the honest way to reach this state now that a room retains a base at its start
 * (`seedStartKeyframe`): an edit inside the retention window IS reachable, which is the point of
 * that fix. What stays out of reach is an edit the window no longer covers.
 */
async function leftBehind() {
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
  for (let index = 0; index < 120; index += 1) {
    await room.applyIncoming({ command: track(`t-${index}`), opId: `bg-${index}` });
  }
  // The authority's own compaction, run early: everything below seq 1 goes, taking our edit with it.
  await deleteEditsBelow(db, "p1", 1);
  return { db, room, harness, author };
}

/** Reconnect and let the held queue reach the authority and the replies come back. */
async function resync(harness: Harness, author: Harness["clients"][number]) {
  author.reconnect();
  await harness.pump();
  author.flush();
  await harness.pump();
  author.flush();
}

describe("an undo of an edit the authority has moved past", () => {
  it("is refused, and the client converges on the authority rather than splitting from it", async () => {
    const { room, harness, author } = await leftBehind();

    author.editLog.undo(); // locally fine: this client's own base still reaches back that far
    expect(author.trackIds()).not.toContain("t-mine");

    await resync(harness, author);

    // Both hold the edit. Before this, the client had dropped it and the authority had not.
    expect(room.snapshot().tracks.map((each) => each.id)).toContain("t-mine");
    expect(author.trackIds()).toContain("t-mine");
  });

  it("says so, rather than failing silently", async () => {
    const { harness, author } = await leftBehind();
    author.editLog.undo();
    await resync(harness, author);

    expect(author.errors).toEqual([expect.stringContaining("too far back to undo")]);
  });

  it("leaves no tombstone in the log for a later reader to honour", async () => {
    const { db, harness, author } = await leftBehind();
    author.editLog.undo();
    await resync(harness, author);

    const log = await readEdits(db, { userId: "local" }, "p1", -1);
    expect(log.filter((entry) => entry.undoes !== undefined)).toEqual([]);
  });

  // The local reflog entry has to go with it. Dropping the op puts the edit back in the live
  // project, but an entry still saying it was undone would take it out again on the next rebuild.
  it("takes the undo off the feed", async () => {
    const { harness, author } = await leftBehind();
    author.editLog.undo();
    await resync(harness, author);

    expect(author.editLog.getEntries().filter((entry) => entry.undoes !== undefined)).toEqual([]);
  });

  // The refusal is permanent - retained bases only move forward, so an edit out of reach never comes
  // back into it. A button that fails identically every press is worse than one that is greyed out.
  it("drops the step rather than offering an undo that can only fail again", async () => {
    const { harness, author } = await leftBehind();
    author.editLog.undo();
    await resync(harness, author);

    expect(author.editLog.getCheckpoints()).toEqual({ undo: [], redo: [] });
    expect(author.editLog.getState().canUndo).toBe(false);
  });
});

describe("an undo the authority can still reach", () => {
  it("is accepted as before, so the refusal is about reach and nothing else", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    const harness = new Harness(room);
    const author = harness.connect("p1", "alice");
    await harness.pump();
    author.flush();

    author.editLog.dispatch(track("t-mine"));
    await harness.pump();
    author.flush();

    author.editLog.undo();
    await harness.pump();
    author.flush();

    expect(room.snapshot().tracks.map((each) => each.id)).not.toContain("t-mine");
    expect((await readEdits(db, { userId: "local" }, "p1", -1)).some((entry) => entry.undoes !== undefined)).toBe(true);
  });
});
