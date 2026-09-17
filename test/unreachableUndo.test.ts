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
import { readEdits } from "../server/db/store";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/**
 * A client whose own edit has been left behind by the authority: the project moved on past the
 * keyframe interval while it was away, so `project.json` was rewritten ABOVE that edit, baking it
 * into the replay floor. The retained ring only takes a slot every 500 edits, so there is nothing
 * older to drop back to.
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
  it("takes the undo off the feed and puts the step back on the undo stack", async () => {
    const { harness, author } = await leftBehind();
    author.editLog.undo();
    await resync(harness, author);

    expect(author.editLog.getEntries().filter((entry) => entry.undoes !== undefined)).toEqual([]);
    expect(author.editLog.getCheckpoints().redo).toEqual([]);
    expect(author.editLog.getCheckpoints().undo).toHaveLength(1);
  });

  // The undo is offered again, and pressing it a second time must not resurrect the split.
  it("stays converged when the user presses undo again", async () => {
    const { room, harness, author } = await leftBehind();
    author.editLog.undo();
    await resync(harness, author);

    author.editLog.undo();
    await resync(harness, author);

    expect(author.trackIds()).toContain("t-mine");
    expect(room.snapshot().tracks.map((each) => each.id)).toContain("t-mine");
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
