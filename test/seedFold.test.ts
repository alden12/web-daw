/**
 * A tombstone for an edit the session has already folded into its seed (DAW-41).
 *
 * `SharedSession` holds a seed, the confirmed entries replayed onto it, and its own pending edits.
 * `trimConfirmed` folds the oldest confirmed entries INTO the seed to keep the replay window finite -
 * and an edit baked into the seed cannot be replayed without. So a tombstone naming one of those used
 * to rebuild to a project that still contained the edit it took back, silently: the authority had
 * removed it, this client had not, and nothing said so.
 *
 * Two answers, in order of cost. The `EditLog` keeps the loaded entries and a base at the oldest
 * retained keyframe, so it reaches back further than the session does and can usually rebuild the
 * thing locally. Only when IT cannot reach either does the session re-read the `project.json` the
 * authority wrote before broadcasting.
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

/** Past `CONFIRMED_WINDOW`, so the earliest entries are folded into the seed and unreachable. */
const BEYOND_THE_WINDOW = 2100;
const TRACKS = 4;
/** The first note added, which is old enough to be inside the seed by the end of the log. */
const UNDONE = TRACKS;

/**
 * A log that is LONG without making the project big: four tracks, one note, then tempo nudges.
 *
 * The session reloads the live project on every confirmed entry, so a log whose every entry adds
 * state makes this test quadratic - a track-per-entry version of it timed out at 14s, and a
 * note-per-entry version at 5s, neither of them saying anything about the thing under test. Tempo
 * changes keep the project two tracks wide while the window still fills, which is all that matters
 * here: the note at `UNDONE` has to end up inside the seed.
 */
const commandFor = (seq: number): EditCommand => {
  if (seq < TRACKS) return { type: "createTrack", instrumentType: "subtractive", id: `t-${seq}`, name: `T${seq}` };
  if (seq === UNDONE)
    return {
      type: "addNote",
      trackId: "t-0",
      clipId: "c-t-0",
      note: { id: `n-${UNDONE}`, start: 0, length: 0.25, pitch: 60, velocity: 0.8 },
    };
  return { type: "setTempo", bpm: 90 + (seq % 40) };
};

const applied = (seq: number): ServerMessage => ({
  type: "editApplied",
  projectId: "p1",
  seq,
  command: commandFor(seq),
  author: "bob",
  opId: `e-${seq}`,
});

/** A peer taking back that first note, long after the fact. */
const undoOfTheOldNote = (seq: number): ServerMessage => ({
  ...(applied(UNDONE) as Extract<ServerMessage, { type: "editApplied" }>),
  seq,
  opId: `undo-${seq}`,
  kind: "undo",
  undoes: `e-${UNDONE}`,
});

function makeSession(readAuthoritativeHead?: () => Promise<{ project: ProjectData; seq: number } | null>) {
  const store = new ProjectStore(false);
  const transport = new StubTransport();
  let counter = 0;
  const nextId = () => `op-${counter++}`;
  const errors: string[] = [];
  const editLog = new EditLog(store, nextId);
  const session = new SharedSession({
    projectStore: store,
    editLog,
    transport,
    projectId: "p1",
    newOpId: nextId,
    onError: (message) => errors.push(message),
    readAuthoritativeHead,
  });
  session.attach();
  transport.open();
  transport.deliver({ type: "snapshot", projectId: "p1", headSeq: -1, entries: [] });
  return { store, transport, errors, editLog };
}

/** Move the log's rebuild base above `seq`, which is what being out of ITS reach looks like. */
const baseAbove = (editLog: EditLog, seq: number): void =>
  editLog.setRebuildBase(new ProjectStore(false).snapshot(), seq);

/** Every note in the project, whichever clip it landed in. */
const noteIds = (store: ProjectStore): string[] =>
  store
    .snapshot()
    .tracks.flatMap((track) => ("clips" in track ? track.clips : []))
    .flatMap((clip) => ("notes" in clip ? (clip.notes as { id: string }[]) : []))
    .map((note) => note.id);

/** The project the authority holds, having rebuilt it without the undone edit. */
const authorityHead = (upTo: number): { project: ProjectData; seq: number } => {
  const store = new ProjectStore(false);
  for (let seq = 0; seq < upTo; seq += 1) {
    if (seq === UNDONE) continue;
    applyEdit(store, commandFor(seq), "bob");
  }
  return { project: store.snapshot(), seq: upTo };
};

describe("an undo of an edit inside the session's seed", () => {
  it("folds it from the edit log, which reaches back further, without asking the network", async () => {
    const { store, transport, errors } = makeSession(async () => {
      throw new Error("the log could answer this; the network should not have been asked");
    });

    for (let seq = 0; seq < BEYOND_THE_WINDOW; seq += 1) transport.deliver(applied(seq));
    expect(noteIds(store)).toContain(`n-${UNDONE}`);

    transport.deliver(undoOfTheOldNote(BEYOND_THE_WINDOW));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(noteIds(store)).not.toContain(`n-${UNDONE}`);
    expect(store.snapshot().tracks).toHaveLength(TRACKS);
    expect(errors).toEqual([]);
  });

  it("re-reads what the authority rebuilt when the log cannot reach it either", async () => {
    const head = authorityHead(BEYOND_THE_WINDOW);
    let reads = 0;
    const { store, transport, errors, editLog } = makeSession(async () => {
      reads += 1;
      return head;
    });

    for (let seq = 0; seq < BEYOND_THE_WINDOW; seq += 1) transport.deliver(applied(seq));
    baseAbove(editLog, UNDONE + 1);

    transport.deliver(undoOfTheOldNote(BEYOND_THE_WINDOW));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reads).toBe(1);
    expect(noteIds(store)).not.toContain(`n-${UNDONE}`);
    // The rest of the project is untouched: this is a swap of the base, not a reset.
    expect(store.snapshot().tempoBpm).toBe(head.project.tempoBpm);
    expect(store.snapshot().tracks).toHaveLength(TRACKS);
    expect(errors).toEqual([]);
  });

  it("says so rather than going quiet when neither can answer", async () => {
    const { store, transport, errors, editLog } = makeSession(async () => null);

    for (let seq = 0; seq < BEYOND_THE_WINDOW; seq += 1) transport.deliver(applied(seq));
    baseAbove(editLog, UNDONE + 1);

    transport.deliver(undoOfTheOldNote(BEYOND_THE_WINDOW));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Still wrong - there is nothing that could make it right - but no longer silent.
    expect(noteIds(store)).toContain(`n-${UNDONE}`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/could not be applied/);
  });

  it("still folds an undo of an edit that is inside the replayed window", async () => {
    const { store, transport, errors } = makeSession(async () => {
      throw new Error("should not need the authority for a foldable undo");
    });

    for (let seq = 0; seq <= UNDONE + 1; seq += 1) transport.deliver(applied(seq));
    expect(noteIds(store)).toContain(`n-${UNDONE}`);

    transport.deliver(undoOfTheOldNote(UNDONE + 2));

    expect(noteIds(store)).not.toContain(`n-${UNDONE}`);
    expect(store.snapshot().tracks).toHaveLength(TRACKS);
    expect(errors).toEqual([]);
  });
});
