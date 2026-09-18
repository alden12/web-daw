/**
 * The authority writes its HEAD keyframe as soon as it takes an edit back (DAW-41).
 *
 * A client that cannot rebuild a tombstone itself recovers by re-reading `project.json`, and that
 * only works if the file it reads is the POST-undo one. On the ordinary hundred-edit cadence it could
 * still be the snapshot from before, and handing that back would undo the undo.
 *
 * But only a DEEP undo needs it - one taking back an edit at or below the last keyframe. Above that,
 * the edit is in the recent tail every client's own log covers, so clients rebuild it from what they
 * hold and never read the file. Writing on every undo would have charged the common case for the
 * rare one.
 */
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeSyncEnv } from "./support/syncEnv";
import { Room } from "../server/api/rooms";
import { files } from "../server/db/schema";
import type { Db } from "../server/db/types";
import type { EditCommand } from "../src/audio/commands/types";
import type { ProjectData } from "../src/audio/project/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

const storedHead = async (db: Db): Promise<(ProjectData & { headSeq?: number }) | null> => {
  const rows = await db
    .select({ json: files.json })
    .from(files)
    .where(and(eq(files.projectId, "p1"), eq(files.path, "project.json")));
  return (rows[0]?.json ?? null) as (ProjectData & { headSeq?: number }) | null;
};

const fill = async (room: Room, count: number, from = 0): Promise<void> => {
  for (let index = from; index < from + count; index += 1) {
    await room.applyIncoming({ command: track(`bg-${index}`), opId: `bg-${index}` });
  }
};

describe("the head keyframe around an undo", () => {
  it("is left alone for an ordinary undo, which every client can rebuild for itself", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: track("t-1"), opId: "e-1" });
    await room.applyIncoming({ command: track("t-2"), opId: "e-2" });

    await room.applyIncoming({ command: track("t-1"), opId: "u-1", kind: "undo", undoes: "e-1" });

    // Nothing near the hundred-edit interval, and the undo did not force one either.
    expect(await storedHead(db)).toBeNull();
    // The room itself is still right, which is what the rebuild is for.
    expect(room.snapshot().tracks.map((each) => each.id)).toEqual(["t-2"]);
  });

  it("is written straight away for an undo from below the last keyframe", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await fill(room, 120); // crosses the cadence, so a keyframe now sits above the early edits
    // One keyframe, at the seq that crossed the interval - the next is due a hundred edits later.
    const cadenceHead = await storedHead(db);
    expect(cadenceHead?.headSeq).toBe(99);

    await room.applyIncoming({ command: track("bg-5"), opId: "u-1", kind: "undo", undoes: "bg-5" });

    const head = await storedHead(db);
    expect(head?.headSeq).toBe(120);
    expect(head?.tracks.map((each) => each.id)).not.toContain("bg-5");
  });

  // The bug the "contested" rule in `headFromLog` exists for: a keyframe written without an edit
  // cannot put it back by replaying forward, so the rebuild has to drop to a base from below it.
  it("does not strand an edit that is undone, keyframed, and then redone", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: track("t-1"), opId: "e-1" });
    await room.applyIncoming({ command: track("t-1"), opId: "u-1", kind: "undo", undoes: "e-1" });
    // Well past the hundred-edit cadence, so the keyframe is rewritten without t-1 several times over.
    await fill(room, 120);

    await room.applyIncoming({ command: track("t-1"), opId: "r-1", kind: "redo", undoes: "e-1" });

    expect(room.snapshot().tracks.map((each) => each.id)).toContain("t-1");
  });
});
