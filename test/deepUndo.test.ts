/**
 * Undoing an edit from further back than this client can rebuild (DAW-38 step 5).
 *
 * The case the deep log was built for: away for a flight, the project moves thousands of edits past
 * your own, and every step you brought back is below the base you can reach. The authority's ladder
 * reaches all of them - so the step is kept, forwarded, and answered, rather than dropped on the
 * client's own authority.
 *
 * Without a remote there is nobody to ask, and the old answer stands: a button that fails every time
 * is worse than a greyed-out one.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id, name: id });

/** A log with three tracks made, and a base that only reaches the last of them. */
function pastTheBase(withRemote: boolean) {
  const store = new ProjectStore(false);
  let counter = 0;
  const log = new EditLog(store, () => `e-${counter++}`);
  const forwarded: { id?: string; kind?: string; undoes?: string }[] = [];
  if (withRemote) log.setRemote((edit) => forwarded.push(edit));

  log.dispatch(track("t-0"));
  log.dispatch(track("t-1"));
  // The state the retained keyframe holds, captured at the seq it reflects.
  const afterTwo = store.snapshot();
  log.dispatch(track("t-2"));
  // The rebuild base advances past the first two, as a retained keyframe does when the project ages.
  log.setRebuildBase(afterTwo, 1);

  return { store, log, forwarded };
}

const trackIds = (store: ProjectStore) => store.snapshot().tracks.map((each) => each.id);

describe("an undo step below the rebuild base", () => {
  it("is kept when there is an authority to ask", () => {
    const { log } = pastTheBase(true);

    // All three steps survive, including the two the base has baked in.
    expect(log.getCheckpoints().undo).toEqual(["e-0", "e-1", "e-2"]);
    expect(log.getState().canUndo).toBe(true);
  });

  // Kept at rest rather than at restore, because the session attaches AFTER the log is restored -
  // deciding it up front would answer "no remote" on every reload and drop the steps a reload exists
  // to bring back. So the question is asked when the step is pressed.
  it("is consumed rather than honoured on a local-only project, where nobody could answer", () => {
    const { store, log } = pastTheBase(false);
    log.undo(); // e-2, above the base: rebuilt here
    expect(trackIds(store)).toEqual(["t-0", "t-1"]);

    log.undo(); // e-1, below it and nobody to ask: the step goes rather than failing where it stands

    expect(trackIds(store)).toEqual(["t-0", "t-1"]);
    expect(log.getCheckpoints().undo).toEqual(["e-0"]);
    // Only the first undo left something to redo; the consumed step did not.
    expect(log.getCheckpoints().redo).toEqual(["e-2"]);
  });

  it("is forwarded rather than simulated, leaving the project alone until the answer comes", () => {
    const { store, log, forwarded } = pastTheBase(true);
    log.undo(); // e-2, which IS above the base
    expect(trackIds(store)).toEqual(["t-0", "t-1"]);
    forwarded.length = 0;

    log.undo(); // e-1, which is not

    // Forwarded, and the project is untouched: rebuilding here would have kept t-1 anyway, and
    // claiming otherwise is how a client and the authority end up holding different projects.
    expect(forwarded.map((edit) => edit.undoes)).toEqual(["e-1"]);
    expect(trackIds(store)).toEqual(["t-0", "t-1"]);
  });

  it("does not come back when a later undo rebuilds, once the authority's answer is adopted", () => {
    const { store, log } = pastTheBase(true);
    log.undo(); // e-2, above the base: rebuilt here, t-2 goes
    log.undo(); // e-1, below it: forwarded, nothing rebuilt here
    expect(trackIds(store)).toEqual(["t-0", "t-1"]);

    // The authority honoured both - it holds bases deep enough for the second - and the session
    // adopted the result, which re-bases this log onto it.
    const authoritative = new ProjectStore(false);
    authoritative.load(store.snapshot());
    authoritative.removeTrack("t-1");
    log.rebaseOnto(authoritative.snapshot(), new Set());

    // Now an ordinary local edit and undo, which DOES rebuild. The deep one must stay taken back:
    // rebuilding from the log's old base would have put t-1 straight back.
    log.dispatch(track("t-3"));
    log.undo();

    expect(trackIds(store)).toEqual(["t-0"]);
  });
});
