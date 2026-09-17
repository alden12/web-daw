import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { VersionStore } from "../src/audio/commands/history";
import { ProjectRepository } from "../src/audio/projectRepository";
import { MemoryBundleStore } from "../src/audio/bundleStore";

/** A project + log + a fresh in-memory repository, sharing one bundle store. */
function setup(repo = new ProjectRepository(new MemoryBundleStore())) {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  return { project, log, repo };
}

describe("VersionStore (commit DAG)", () => {
  afterEach(() => vi.useRealTimers());

  it("commits uncommitted edits and chains them by parent (newest first)", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    const a = await vs.commit("first", "you");
    expect(a?.parent).toBeNull();

    log.dispatch({ type: "setTempo", bpm: 90 }, "claude");
    const b = await vs.commit("second", "claude");
    expect(b?.parent).toBe(a!.id);
    expect(b?.author).toBe("claude");

    const hist = await vs.history();
    expect(hist.map((c) => c.message)).toEqual(["second", "first"]);
  });

  it("is a no-op when there is nothing uncommitted", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-1" });
    expect(await vs.commit("x")).toBeTruthy();
    expect(await vs.commit("again")).toBeNull();
  });

  it("auto-checkpoints a burst of edits after the debounce", async () => {
    vi.useFakeTimers();
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    const dispose = vs.attach();

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "setTempo", bpm: 110 });
    await vi.runAllTimersAsync(); // fire the debounced checkpoint + flush its writes
    dispose();

    const hist = await vs.history();
    expect(hist).toHaveLength(1);
    expect(hist[0].auto).toBe(true);
    expect(hist[0].entryCount).toBe(2); // both edits in one checkpoint
  });

  it("persists the DAG: a new store on the same repo reads the history", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    await vs.commit("only", "you");

    const vs2 = new VersionStore(project, log, repo); // simulate reload
    await vs2.load();
    expect((await vs2.history()).map((c) => c.message)).toEqual(["only"]);
    // lastCommittedSeq restored -> no phantom re-commit of already-committed edits.
    expect(await vs2.commit("noop")).toBeNull();
  });

  it("starts history from the current point when loading a project with no commits", async () => {
    const { project, log, repo } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-1" }); // pre-existing working edit
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    expect(await vs.commit("nothing new")).toBeNull(); // not retro-committed
    log.dispatch({ type: "setTempo", bpm: 100 });
    expect(await vs.commit("forward")).toBeTruthy();
  });

  it("treats a commit as a coalescing boundary (same-target edits after it are new)", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    // Same-target edits in one tick coalesce; commit, then edit the same target
    // again in the same tick - it must NOT fold into the committed entry.
    log.dispatch({ type: "setTempo", bpm: 90 });
    expect(await vs.commit("v1")).toBeTruthy();
    log.dispatch({ type: "setTempo", bpm: 91 });
    expect(await vs.commit("v2")).toBeTruthy(); // would be null without the boundary reset
  });

  it("reverts to an earlier commit and records it as a new HEAD", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    const v1 = await vs.commit("v1", "you"); // one track
    expect(v1).toBeTruthy();

    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-2" }); // distinct, non-coalescing edit
    const v2 = await vs.commit("v2", "you"); // two tracks
    expect(v2).toBeTruthy();
    expect(project.getTrack("t-2")).toBeTruthy();

    const rev = await vs.revertTo(v1!.id, "you");
    expect(project.getTrack("t-2")).toBeUndefined(); // live state jumped back to v1
    expect(project.getTrack("t-1")).toBeTruthy();
    // History is append-only: v1, v2, then the revert on top (newest first).
    const hist = await vs.history();
    expect(hist[0].id).toBe(rev!.id);
    expect(hist.map((c) => c.message)).toEqual(['Revert to "v1"', "v2", "v1"]);
  });

  it("diffs two commits in musical terms", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    const a = await vs.commit("a", "you");
    log.dispatch({ type: "setTempo", bpm: 96 });
    const b = await vs.commit("b", "you");

    expect(await vs.diff(a!.id, b!.id)).toContain("Tempo 120 -> 96 BPM");
  });

  // --- feed notes anchored to commits ---------------------------------------

  it("sweeps uncommitted feed notes into the commit, and replay ignores them", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.note("about to add the bass", "claude");
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-1" });
    const c = await vs.commit("bass in", "claude");
    expect(c?.noteCount).toBe(1);

    const stored = await repo.readCommit(c!.id);
    expect(stored!.notes?.map((n) => n.text)).toEqual(["about to add the bass"]);
    // Notes are not edits: entryCount counts only the edit, and a revert (replay)
    // reconstructs state purely from edits - the note never executes.
    expect(stored!.entryCount).toBe(1);
    await vs.revertTo(c!.id, "you");
    expect(project.getTrack("t-1")).toBeTruthy();
  });

  it("does not commit on a note alone (a note creates no uncommitted edit)", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    log.note("just thinking out loud", "claude");
    expect(await vs.commit("nope")).toBeNull(); // nothing to commit yet

    // The pending note rides into the next real commit.
    log.dispatch({ type: "setTempo", bpm: 100 });
    const c = await vs.commit("first real change", "claude");
    expect((await repo.readCommit(c!.id))!.notes?.map((n) => n.text)).toEqual(["just thinking out loud"]);
  });

  it("anchors each note to the commit it was posted before, not a later one", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.note("first idea", "claude");
    log.dispatch({ type: "setTempo", bpm: 80 });
    const a = await vs.commit("a", "claude");

    log.note("second idea", "claude");
    log.dispatch({ type: "setTempo", bpm: 90 });
    const b = await vs.commit("b", "claude");

    expect((await repo.readCommit(a!.id))!.notes?.map((n) => n.text)).toEqual(["first idea"]);
    expect((await repo.readCommit(b!.id))!.notes?.map((n) => n.text)).toEqual(["second idea"]);
  });

  // --- keyframe + delta storage ---------------------------------------------

  it("stores deltas after the root keyframe and replays them exactly", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    // A run of distinct forward edits, one commit each. Only the first is the root
    // keyframe; the rest are deltas (no stored snapshot).
    const ids: string[] = [];
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    ids.push((await vs.commit("c0", "you"))!.id);
    for (let i = 1; i <= 5; i++) {
      log.dispatch({ type: "setTempo", bpm: 100 + i });
      log.dispatch({
        type: "addNote",
        trackId: "t-1",
        note: { id: `n-${i}`, pitch: 60 + i, start: i, length: 1, velocity: 0.8 },
      });
      ids.push((await vs.commit(`c${i}`, "you"))!.id);
    }

    const root = await repo.readCommit(ids[0]);
    const second = await repo.readCommit(ids[1]);
    const last = await repo.readCommit(ids[ids.length - 1]);
    expect(root!.snapshot).toBeTruthy(); // root is a keyframe
    expect(second!.snapshot).toBeUndefined(); // a delta - no stored snapshot
    expect(last!.snapshot).toBeUndefined();

    // Reverting to the HEAD delta must reconstruct the exact live state.
    const live = project.snapshot();
    await vs.revertTo(ids[ids.length - 1], "you");
    expect(project.snapshot()).toEqual(live);
    expect(project.getTrack("t-1")).toBeTruthy();
    expect(project.tempo).toBe(105);
  });

  it("writes a keyframe on the cadence so long histories stay replayable", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    // 20 commits: root (keyframe) + 19 more; a keyframe falls on the cadence.
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      log.dispatch({ type: "setTempo", bpm: 60 + i });
      ids.push((await vs.commit(`v${i}`, "you"))!.id);
    }
    const haveSnapshot = await Promise.all(ids.map(async (id) => !!(await repo.readCommit(id))!.snapshot));
    const keyframeCount = haveSnapshot.filter(Boolean).length;
    expect(keyframeCount).toBeGreaterThanOrEqual(2); // root + at least one cadence keyframe
    // Every commit still materializes to the right tempo (spot-check a late delta).
    expect(await vs.diff(ids[18], ids[19])).toContain("Tempo 78 -> 79 BPM");
  });

  it("forces a keyframe on a commit that contains undo/redo (cannot replay forward)", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    await vs.commit("base", "you"); // root keyframe

    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-2" });
    log.undo(); // removes t-2; this entry restores a snapshot, not a forward edit
    const c = await vs.commit("with undo", "you");

    const stored = await repo.readCommit(c!.id);
    expect(stored!.snapshot).toBeTruthy(); // forced keyframe
    // And the materialized state is correct: t-2 was undone away.
    await vs.revertTo(c!.id, "you");
    expect(project.getTrack("t-2")).toBeUndefined();
    expect(project.getTrack("t-1")).toBeTruthy();
  });

  it("recomputes the keyframe distance on reload so cadence continues correctly", async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    for (let i = 0; i < 5; i++) {
      log.dispatch({ type: "setTempo", bpm: 70 + i });
      await vs.commit(`v${i}`, "you");
    }

    // Reload mid-cadence; new commits must still materialize correctly.
    const vs2 = new VersionStore(project, log, repo);
    await vs2.load();
    log.dispatch({ type: "setTempo", bpm: 90 });
    const head = await vs2.commit("after reload", "you");
    const hist = await vs2.history();
    expect(hist[0].id).toBe(head!.id);
    expect(await vs2.diff(hist[1].id, head!.id)).toContain("Tempo 74 -> 90 BPM");
  });
});

// --- remote mode: history derived from the authoritative log's markers -------------------------------

import type { EditEntry } from "../src/audio/commands/types";
import { commitKeyframePath } from "../src/audio/history/paths";

/** A confirmed authoritative log entry (edit or version marker) at a given seq. */
const entry = (seq: number, command: EditEntry["command"], author = "you"): EditEntry => ({
  seq,
  command,
  author,
  time: seq,
  kind: "edit",
});
const track = (id: string) => ({ type: "createTrack", instrumentType: "subtractive", id }) as EditEntry["command"];
const commit = (message: string) => ({ type: "commit", message }) as EditEntry["command"];

/** A ProjectData snapshot with one named track (a distinct state to revert / diff against). */
function snapshotWithTrack(id: string, name: string) {
  const project = new ProjectStore(false);
  project.addTrack("subtractive", { id, name });
  return project.snapshot();
}

describe("VersionStore (remote / server-authoritative history)", () => {
  /** A remote-mode store over a seeded in-memory bundle + a capturing commit sink. */
  async function remoteSetup(seed: EditEntry[] = []) {
    const bundle = new MemoryBundleStore();
    if (seed.length > 0) await bundle.appendEdits(seed);
    const repo = new ProjectRepository(bundle);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const posted: { message: string; author: string }[] = [];
    const vs = new VersionStore(project, log, repo);
    vs.setRemote({ postCommit: (message, author) => posted.push({ message, author }) });
    await vs.load();
    return { bundle, repo, project, log, vs, posted };
  }

  it("derives the version list from the log's markers, newest first, keyed by authoritative seq", async () => {
    const { vs } = await remoteSetup([
      entry(0, track("t-0")),
      entry(1, track("t-1")),
      entry(2, commit("v1")),
      entry(3, track("t-2")),
      entry(4, commit("v2"), "claude"),
    ]);

    const hist = await vs.history();
    expect(hist.map((commit) => [commit.id, commit.message, commit.parent])).toEqual([
      ["4", "v2", "2"],
      ["2", "v1", null],
    ]);
    expect(hist[0].author).toBe("claude");
    expect(hist[1].entryCount).toBe(2); // the two edits before v1
    expect(hist[0].entryCount).toBe(1); // the one edit between v1 and v2
  });

  it("reports HEAD + uncommitted from the log", async () => {
    // A trailing edit after the last marker -> uncommitted work, HEAD is the last marker.
    const withPending = await remoteSetup([entry(0, track("t-0")), entry(1, commit("v1")), entry(2, track("t-1"))]);
    expect(withPending.vs.getState()).toMatchObject({ headId: "1", hasUncommitted: true });

    // Nothing after the last marker -> clean.
    const clean = await remoteSetup([entry(0, track("t-0")), entry(1, commit("v1"))]);
    expect(clean.vs.getState()).toMatchObject({ headId: "1", hasUncommitted: false });
  });

  it("authors a commit through the session sink only when there is uncommitted work", async () => {
    const { vs, posted } = await remoteSetup([entry(0, track("t-0"))]); // one edit, no marker yet
    expect(await vs.commit("first", "you")).toBeNull(); // no synthesized summary (rides sync)
    expect(posted).toEqual([{ message: "first", author: "you" }]);

    // With the marker now present and nothing after it, a further commit is a no-op.
    const clean = await remoteSetup([entry(0, track("t-0")), entry(1, commit("first"))]);
    await clean.vs.commit("again", "you");
    expect(clean.posted).toEqual([]);
  });

  it("reverts by dispatching a loadSnapshot of the target's pinned keyframe, applied optimistically", async () => {
    const { bundle, log, project, vs } = await remoteSetup([
      entry(0, track("t-old")),
      entry(1, commit("v1")),
      entry(2, track("t-new")),
      entry(3, commit("v2")),
    ]);
    // Pin v1's keyframe (state at seq 1): one track "t-old". Current live state is empty.
    await bundle.writeText(commitKeyframePath(1), JSON.stringify({ ...snapshotWithTrack("t-old", "Old"), headSeq: 1 }));

    const dispatched: EditEntry["command"][] = [];
    log.setRemote((command) => dispatched.push(command));
    await vs.revertTo("1", "you");

    // Optimistically applied: the live project jumped to v1's state.
    expect(project.getTrack("t-old")).toBeTruthy();
    // And it rode the sync pipeline as a loadSnapshot carrying that snapshot + a naming message.
    expect(dispatched).toHaveLength(1);
    const revert = dispatched[0] as { type: string; message: string; project: { tracks: unknown[] } };
    expect(revert.type).toBe("loadSnapshot");
    expect(revert.message).toBe('Revert to "v1"');
    expect(revert.project.tracks).toHaveLength(1);
  });

  it("diffs two versions by materialising their pinned keyframes", async () => {
    const { bundle, vs } = await remoteSetup([entry(0, commit("a")), entry(1, commit("b"))]);
    const slow = new ProjectStore(false);
    slow.setTempo(90);
    const fast = new ProjectStore(false);
    fast.setTempo(140);
    await bundle.writeText(commitKeyframePath(0), JSON.stringify({ ...slow.snapshot(), headSeq: 0 }));
    await bundle.writeText(commitKeyframePath(1), JSON.stringify({ ...fast.snapshot(), headSeq: 1 }));

    expect(await vs.diff("0", "1")).toContain("Tempo 90 -> 140 BPM");
  });

  it("notifies subscribers when the log advances", async () => {
    const { vs } = await remoteSetup([entry(0, track("t-0"))]);
    let fired = 0;
    vs.subscribe(() => (fired += 1));
    await vs.onLogAdvanced();
    expect(fired).toBe(1);
  });
});
