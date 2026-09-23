/**
 * A reconnect after more edits than the catch-up snapshot carries.
 *
 * The room sends the newest `SNAPSHOT_WINDOW` (2000) entries on subscribe, not everything since the
 * client's head. A client away for longer got a window starting above it and folded that forward onto
 * a base missing everything in between - each entry applies fine on its own, so nothing said so. It
 * now adopts the authority's `project.json` (rewritten every 100 edits, so always inside the window)
 * and folds the window from there.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { SharedSession } from "../src/audio/sync/sharedSession";
import { StubTransport } from "./support/syncHarness";
import { applyEdit } from "../src/audio/commands/applyEdit";
import type { EditCommand } from "../src/audio/commands/types";
import type { ProjectData } from "../src/audio/project/types";
import type { ServerMessage } from "../src/contract/ws";

const SNAPSHOT_WINDOW = 2000;
/** Where the client left off, and how far the authority got while it was away. */
const CLIENT_HEAD = 0;
const AUTHORITY_HEAD = 2500;
/** The authority's last keyframe, which is what `project.json` holds. */
const KEYFRAME_SEQ = 2400;

/** A track at seq 0, then one track every 250 edits, tempo nudges in between: the tracks say which
 *  edits made it, and the project stays small enough to replay quickly. */
const commandFor = (seq: number): EditCommand =>
  seq % 250 === 0
    ? { type: "createTrack", instrumentType: "subtractive", id: `t-${seq}`, name: `T${seq}` }
    : { type: "setTempo", bpm: 90 + (seq % 40) };

const entry = (seq: number) => ({
  seq,
  id: `e-${seq}`,
  command: commandFor(seq),
  author: "bob",
  time: 0,
  kind: "edit" as const,
});

const projectAt = (upTo: number): ProjectData => {
  const store = new ProjectStore(false);
  for (let seq = 0; seq <= upTo; seq += 1) applyEdit(store, commandFor(seq), "bob");
  return store.snapshot();
};

const windowFrom = (headSeq: number): ServerMessage => ({
  type: "snapshot",
  projectId: "p1",
  headSeq,
  entries: Array.from({ length: SNAPSHOT_WINDOW }, (_, index) => entry(headSeq - SNAPSHOT_WINDOW + 1 + index)),
});

function makeSession(readAuthoritativeHead?: () => Promise<{ project: ProjectData; seq: number } | null>) {
  const store = new ProjectStore(false);
  store.load(projectAt(CLIENT_HEAD));
  const transport = new StubTransport();
  let counter = 0;
  const nextId = () => `op-${counter++}`;
  const errors: string[] = [];
  const session = new SharedSession({
    projectStore: store,
    editLog: new EditLog(store, nextId),
    transport,
    projectId: "p1",
    baseSeq: CLIENT_HEAD,
    newOpId: nextId,
    onError: (message) => errors.push(message),
    readAuthoritativeHead,
  });
  session.attach();
  transport.open();
  return { store, transport, errors };
}

const trackIds = (store: ProjectStore): string[] => store.snapshot().tracks.map((track) => track.id);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a snapshot that does not reach back to the client's head", () => {
  it("adopts the authority's head and folds the window above it", async () => {
    const { store, transport, errors } = makeSession(async () => ({
      project: projectAt(KEYFRAME_SEQ),
      seq: KEYFRAME_SEQ,
    }));

    transport.deliver(windowFrom(AUTHORITY_HEAD));
    await settle();

    expect(errors).toEqual([]);
    // Every track, including t-250, which sits in the gap below the window.
    const everyTrack = Array.from({ length: AUTHORITY_HEAD / 250 + 1 }, (_, index) => `t-${index * 250}`);
    expect(trackIds(store)).toEqual(everyTrack);
  });

  it("holds a peer edit that arrives while the head is still being read, and folds it after", async () => {
    let release: () => void = () => {};
    const { store, transport } = makeSession(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ project: projectAt(KEYFRAME_SEQ), seq: KEYFRAME_SEQ });
        }),
    );

    transport.deliver(windowFrom(AUTHORITY_HEAD));
    transport.deliver({
      type: "editApplied",
      projectId: "p1",
      seq: AUTHORITY_HEAD + 1,
      command: { type: "createTrack", instrumentType: "subtractive", id: "t-late", name: "Late" },
      author: "bob",
      opId: "e-late",
    });
    await settle(); // the catch-up starts reading the head
    release();
    await settle();

    expect(trackIds(store)).toContain("t-250");
    expect(trackIds(store).at(-1)).toBe("t-late");
  });

  it("says to reload, rather than folding over the hole, when it cannot bridge the gap", async () => {
    const { store, transport, errors } = makeSession(async () => null);

    transport.deliver(windowFrom(AUTHORITY_HEAD));
    await settle();

    expect(errors).toHaveLength(1);
    expect(trackIds(store)).toEqual(["t-0"]);
  });
});
