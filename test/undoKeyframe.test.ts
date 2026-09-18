/**
 * The authority writes its HEAD keyframe as soon as it takes an edit back (DAW-41).
 *
 * A peer that cannot honour a tombstone itself - one naming an edit already folded into its seed -
 * recovers by re-reading `project.json`. That only works if the file it reads is the POST-undo one.
 * On the ordinary hundred-edit cadence it could still be the snapshot from before, and handing that
 * back to a peer would undo the undo.
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

describe("the head keyframe after an undo", () => {
  it("is written straight away, not on the next cadence", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: track("t-1"), opId: "e-1" });
    await room.applyIncoming({ command: track("t-2"), opId: "e-2" });

    // Nothing near the hundred-edit interval, so without the tombstone rule there is no keyframe yet.
    expect(await storedHead(db)).toBeNull();

    await room.applyIncoming({ command: track("t-1"), opId: "u-1", kind: "undo", undoes: "e-1" });

    const head = await storedHead(db);
    expect(head?.headSeq).toBe(2);
    expect(head?.tracks.map((each) => each.id)).toEqual(["t-2"]);
  });

  // The bug the "contested" rule in `headFromLog` exists for, and it predates the immediate write:
  // on the hundred-edit cadence the keyframe simply landed later, and the redo failed just the same.
  it("does not strand an edit that is undone, keyframed, and then redone", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: track("t-1"), opId: "e-1" });
    await room.applyIncoming({ command: track("t-1"), opId: "u-1", kind: "undo", undoes: "e-1" });
    // Well past the hundred-edit cadence, so the keyframe is rewritten without t-1 several times over.
    for (let index = 0; index < 120; index += 1) {
      await room.applyIncoming({ command: track(`bg-${index}`), opId: `bg-${index}` });
    }

    await room.applyIncoming({ command: track("t-1"), opId: "r-1", kind: "redo", undoes: "e-1" });

    expect(room.snapshot().tracks.map((each) => each.id)).toContain("t-1");
  });

  it("reflects a redo the same way", async () => {
    const { db } = await makeSyncEnv();
    const room = await Room.load(db, "local", "p1");
    await room.applyIncoming({ command: track("t-1"), opId: "e-1" });
    await room.applyIncoming({ command: track("t-1"), opId: "u-1", kind: "undo", undoes: "e-1" });
    await room.applyIncoming({ command: track("t-1"), opId: "r-1", kind: "redo", undoes: "e-1" });

    const head = await storedHead(db);
    expect(head?.headSeq).toBe(2);
    expect(head?.tracks.map((each) => each.id)).toEqual(["t-1"]);
  });
});
