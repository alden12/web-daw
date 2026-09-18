/**
 * The startup order, which quietly decided what was undoable (DAW-38 step 5).
 *
 * `restoreProject` restores the stacks; `AppShell` constructs the session and attaches it afterwards,
 * because the session needs the loaded project's id and base seq. So anything the log decides about
 * "is there an authority to ask" while restoring answers NO - and the first version of step 5 asked
 * exactly then, dropping every deep step on every reload, which is the one moment it exists for.
 *
 * The question is asked when a step is pressed, and `canUndo` re-derives it, so attaching a remote
 * later moves the button rather than arriving too late to matter.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id, name: id });

describe("the real startup order: restore, then attach the session", () => {
  it("keeps deep steps, and only offers them once there is a remote", () => {
    const store = new ProjectStore(false);
    let counter = 0;
    const log = new EditLog(store, () => `e-${counter++}`);
    log.dispatch(track("t-0"));
    log.dispatch(track("t-1"));
    const afterTwo = store.snapshot();
    log.dispatch(track("t-2"));
    const stored = log.getCheckpoints();

    // What `restoreProject` does, in that order...
    log.setRebuildBase(afterTwo, 1);
    log.restoreCheckpoints(stored);
    // ...and only then does AppShell construct the session and attach it.
    // Held all along, but not offered while nobody could answer them.
    expect(log.getCheckpoints().undo).toEqual(["e-0", "e-1", "e-2"]);
    expect(log.getState().canUndo).toBe(true); // e-2 is above the base, so this much is local

    log.setRebuildBase(afterTwo, 2); // now every step is below it
    expect(log.getState().canUndo).toBe(false);

    log.setRemote(() => {});

    expect(log.getState().canUndo).toBe(true);
    expect(log.getCheckpoints().undo).toEqual(["e-0", "e-1", "e-2"]);
  });
});
