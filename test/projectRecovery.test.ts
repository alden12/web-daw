/**
 * DAW-38, the recovery action: a project whose saved state cannot be read comes back from its log.
 *
 * The bug underneath this is not the corruption, it is what the corruption used to MEAN. `load`
 * answered "no keyframe" with null, callers read null as "nothing saved here yet", and autosave
 * answered that by writing the empty live store over the top - taking the log that could have
 * rebuilt the project with it. So most of what follows is about the distinction between an empty
 * bundle and a damaged one, and only then about the rebuild.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { MemoryBundleStore } from "../src/audio/bundleStore";
import { ProjectRepository, UnreadableProjectError } from "../src/audio/projectRepository";
import { rebuildProjectState, reportUnreadableProject } from "../src/audio/projects/recovery";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

/** A project, its log, and a dispatch that leaves a coalescing boundary after each edit. */
function seededLog() {
  const project = new ProjectStore(false);
  let counter = 0;
  const log = new EditLog(project, () => `e-${counter++}`);
  const edit = (command: EditCommand) => {
    log.dispatch(command);
    log.resetCoalescing();
  };
  return { project, log, edit };
}

/** A saved bundle holding `ids` as tracks, keyframed at its head. Returns the store it lives in. */
async function savedBundle(ids: string[]): Promise<MemoryBundleStore> {
  const store = new MemoryBundleStore();
  const repo = new ProjectRepository(store, "p-recover");
  const { project, log, edit } = seededLog();
  for (const id of ids) edit(track(id));
  await repo.save(project.snapshot(), log.getEntries(), log.getNotes());
  return store;
}

/** A fresh repository over the same bundle - what a reload gets, with none of the cached state. */
const reopen = (store: MemoryBundleStore) => new ProjectRepository(store, "p-recover");

const trackIds = (project: { tracks: { id: string }[] }) => project.tracks.map((each) => each.id);

describe("a bundle that cannot be read says so", () => {
  it("reports a project.json that is not JSON", async () => {
    const store = await savedBundle(["t-1"]);
    await store.writeText("project.json", "{ this is not json");

    await expect(reopen(store).load()).rejects.toBeInstanceOf(UnreadableProjectError);
  });

  it("reports a project.json that is JSON but is not a project", async () => {
    const store = await savedBundle(["t-1"]);
    await store.writeText("project.json", JSON.stringify({ hello: "world" }));

    await expect(reopen(store).load()).rejects.toBeInstanceOf(UnreadableProjectError);
  });

  it("reports a log that will not parse, which is as much the project as the keyframe is", async () => {
    const store = await savedBundle(["t-1"]);
    await store.writeText("edits.json", "[ truncated");

    await expect(reopen(store).load()).rejects.toBeInstanceOf(UnreadableProjectError);
  });

  // The case the whole distinction exists for. Null here would be read as "nothing saved yet", and
  // the log below would be overwritten by an empty project rather than used to rebuild one.
  it("reports a missing project.json when there is a log to rebuild from", async () => {
    const store = await savedBundle(["t-1", "t-2"]);
    await store.writeText("project.json", "");

    await expect(reopen(store).load()).rejects.toBeInstanceOf(UnreadableProjectError);
  });

  // And the other side of it: a project whose first save did not finish has a manifest and nothing
  // else. There is nothing to lose there, so it stays "nothing saved yet" and gets seeded normally.
  it("still reads a bundle with neither a keyframe nor a log as empty", async () => {
    const store = new MemoryBundleStore();
    await store.writeText("manifest.json", JSON.stringify({ formatVersion: 1, projectId: "p-half", projectSchema: 0 }));

    expect(await reopen(store).load()).toBeNull();
  });

  it("still reads an untouched bundle as empty", async () => {
    expect(await reopen(new MemoryBundleStore()).load()).toBeNull();
  });
});

describe("rebuilding from the log", () => {
  it("produces the project the unreadable keyframe held", async () => {
    const store = await savedBundle(["t-1", "t-2", "t-3"]);
    const expected = trackIds((await reopen(store).load())!.project);
    await store.writeText("project.json", "{ corrupt");

    const rebuilt = await reopen(store).rebuildFromLog();

    expect(rebuilt).not.toBeNull();
    expect(trackIds(rebuilt!.project)).toEqual(expected);
  });

  // The rebuild honours the log's tombstones for the same reason `load` does: an undo is a fact in
  // the log, so a recovered project must not resurrect the edit it took back.
  it("does not put back an edit the log says was undone", async () => {
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store, "p-recover");
    const { project, log, edit } = seededLog();
    edit(track("t-1"));
    edit(track("t-2"));
    log.undo();
    await repo.save(project.snapshot(), log.getEntries(), log.getNotes());
    await store.writeText("project.json", "{ corrupt");

    const rebuilt = await reopen(store).rebuildFromLog();

    expect(trackIds(rebuilt!.project)).toEqual(["t-1"]);
  });

  // No floor and no reach back to the project's first edit: replaying the tail onto an empty project
  // would produce something that looks like a project and is not this one, so it refuses instead.
  it("refuses when nothing sits below the log it has", async () => {
    const store = new MemoryBundleStore();
    await store.writeText("manifest.json", JSON.stringify({ formatVersion: 1, projectId: "p-gap", projectSchema: 0 }));
    await store.appendEdits([{ seq: 5, id: "e-5", command: track("t-late"), author: "you", time: 0, kind: "edit" }]);

    await expect(reopen(store).load()).rejects.toBeInstanceOf(UnreadableProjectError);
    expect(await reopen(store).rebuildFromLog()).toBeNull();
  });

  // A base further down than the log reaches is a gap, not a floor. Replaying this tail onto it would
  // drop the entries in between and produce a project nothing ever was.
  it("refuses a base the log no longer reaches", async () => {
    const store = await savedBundle(["t-1", "t-2", "t-3", "t-4"]);
    const whole = await store.readEdits(-1);
    await store.writeText("edits.json", JSON.stringify(whole.slice(2))); // seq 0 and 1 pruned away
    await store.writeText("project.json", "{ corrupt");

    expect(await reopen(store).rebuildFromLog()).toBeNull();
  });

  // The combination that used to be the most dangerous, because it read as an empty bundle: nothing
  // readable at all, so the log must not be answered with an autosave writing over it.
  it("reports a corrupt log beside a missing keyframe rather than calling the bundle empty", async () => {
    const store = await savedBundle(["t-1"]);
    await store.writeText("project.json", "");
    await store.writeText("edits.json", "[ truncated");

    await expect(reopen(store).load()).rejects.toBeInstanceOf(UnreadableProjectError);
  });
});

describe("the recovery action", () => {
  it("heals the bundle, so the next load is an ordinary one", async () => {
    const store = await savedBundle(["t-1", "t-2"]);
    await store.writeText("project.json", "{ corrupt");

    const outcome = await rebuildProjectState(reopen(store));

    expect(outcome).toEqual({ status: "rebuilt", entries: 2 });
    const reloaded = await reopen(store).load();
    expect(trackIds(reloaded!.project)).toEqual(["t-1", "t-2"]);
  });

  it("says so when nothing here can rebuild it, which is what offers the fresh project", async () => {
    const store = new MemoryBundleStore();
    await store.writeText("manifest.json", JSON.stringify({ formatVersion: 1, projectId: "p-gap", projectSchema: 0 }));

    expect(await rebuildProjectState(reopen(store))).toEqual({ status: "unrebuildable" });
  });
});

describe("reporting it to the shell", () => {
  it("passes on the unreadable-project error and nothing else", () => {
    expect(reportUnreadableProject(new UnreadableProjectError("project.json is missing"))).toBe(true);
    expect(reportUnreadableProject(new Error("the network went away"))).toBe(false);
  });
});
