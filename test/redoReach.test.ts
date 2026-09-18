/**
 * A redo of an edit this session never saw (DAW-41).
 *
 * The mirror of the seed-fold bug, and it hid behind a plausible-sounding shortcut: a redo reads as
 * the safe direction, putting an edit back rather than taking one out, so it was folded without
 * checking reach. But the seed it replays onto may be one this session ADOPTED after a deep undo, in
 * which case the edit is baked out of it and there is nothing in the window to put back - so the redo
 * vanished silently, which is the exact failure the check exists to prevent, arriving from the other
 * side.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { SharedSession } from "../src/audio/sync/sharedSession";
import { StubTransport } from "./support/syncHarness";
import type { ProjectData } from "../src/audio/project/types";
import type { ServerMessage } from "../src/contract/ws";

const withTracks = (...ids: string[]): ProjectData => {
  const store = new ProjectStore(false);
  for (const id of ids) store.addTrack("subtractive", { id, name: id });
  return store.snapshot();
};

describe("a redo of an edit the session never saw", () => {
  it("puts the edit back, by taking the authority's answer for it", async () => {
    const store = new ProjectStore(false);
    const transport = new StubTransport();
    let counter = 0;
    const nextId = () => `op-${counter++}`;
    // The authority's head: t-0 exists, then the undo takes it out, then the redo puts it back.
    let head = { project: withTracks("t-0", "t-1"), seq: 5 };
    const session = new SharedSession({
      projectStore: store,
      editLog: new EditLog(store, nextId),
      transport,
      projectId: "p1",
      baseSeq: 5, // joined late: t-0 was created long before this tab existed
      newOpId: nextId,
      readAuthoritativeHead: async () => head,
    });
    session.attach();
    transport.open();
    store.load(withTracks("t-0", "t-1"));
    transport.deliver({ type: "snapshot", projectId: "p1", headSeq: 5, entries: [] });

    const reflog = (seq: number, opId: string, kind: "undo" | "redo"): ServerMessage => ({
      type: "editApplied",
      projectId: "p1",
      seq,
      command: { type: "createTrack", instrumentType: "subtractive", id: "t-0", name: "t-0" },
      author: "bob",
      opId,
      kind,
      undoes: "e-0",
    });

    head = { project: withTracks("t-1"), seq: 6 };
    transport.deliver(reflog(6, "u-1", "undo"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.snapshot().tracks.map((each) => each.id)).toEqual(["t-1"]);

    head = { project: withTracks("t-0", "t-1"), seq: 7 };
    transport.deliver(reflog(7, "r-1", "redo"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.snapshot().tracks.map((each) => each.id)).toContain("t-0");
  });
});
