/**
 * DAW-34 stage E: an undo is a fact IN the log, not a set held beside it.
 *
 * Undo used to be an exclusion set the client kept in memory and persisted to `undo.json`. The log
 * recorded that an undo had happened - a feed row saying "Undid: ..." - but not which edit it took
 * back, so nothing reading the log could tell what the project was supposed to be. A tombstone
 * names the edit, which makes the log a complete account: replay every edit except the ones a
 * tombstone above them takes back.
 *
 * It is append-only and itself ordered, so replaying only as far as some seq honours only the
 * tombstones at or below it - an older state stays what it was rather than acquiring later undos.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { ProjectRepository } from "../src/audio/projectRepository";
import { MemoryBundleStore } from "../src/audio/bundleStore";
import { replayEntries, tombstonedIds } from "../src/audio/commands/replay";
import type { EditCommand } from "../src/audio/commands/types";

const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

function seededLog() {
  const project = new ProjectStore(false);
  let counter = 0;
  const log = new EditLog(project, () => `e-${counter++}`);
  /** Dispatch with a boundary after each, so nothing coalesces into its neighbour. */
  const edit = (command: EditCommand) => {
    log.dispatch(command);
    log.resetCoalescing();
  };
  return { project, log, edit };
}

describe("the tombstone entry", () => {
  it("names the edit an undo took back, rather than only that one happened", () => {
    const { log, edit } = seededLog();
    edit(track("t-1"));
    edit({ type: "setTempo", bpm: 140 });
    log.undo();

    const marker = log.getEntries().at(-1);
    expect(marker?.kind).toBe("undo");
    expect(marker?.undoes).toBe("e-1");
    // Still a readable feed row, which is what it was before.
    expect(marker?.label).toMatch(/^Undid: /);
  });

  it("records a redo as the tombstone being lifted", () => {
    const { log, edit } = seededLog();
    edit({ type: "setTempo", bpm: 140 });
    log.undo();
    log.redo();

    const marker = log.getEntries().at(-1);
    expect(marker?.kind).toBe("redo");
    expect(marker?.undoes).toBe("e-0");
    expect(tombstonedIds(log.getEntries())).toEqual(new Set());
  });

  it("takes the later of an undo and a redo of the same edit", () => {
    const { log, edit } = seededLog();
    edit({ type: "setTempo", bpm: 140 });
    log.undo();
    log.redo();
    log.undo();

    expect(tombstonedIds(log.getEntries())).toEqual(new Set(["e-0"]));
  });
});

describe("replaying a log honours its tombstones", () => {
  it("leaves out an edit a tombstone takes back", () => {
    const { log, edit } = seededLog();
    edit(track("t-1"));
    edit(track("t-2"));
    log.undo(); // takes back t-2

    const replayed = new ProjectStore(false);
    replayEntries(replayed, log.getEntries());

    expect(replayed.getTracks().map((each) => each.id)).toEqual(["t-1"]);
  });

  // The ordering requirement: a past point must not acquire undos made after it.
  it("honours only the tombstones at or below the seq it replays to", () => {
    const { log, edit } = seededLog();
    edit(track("t-1"));
    edit(track("t-2"));
    const beforeTheUndo = log.getEntries().at(-1)!.seq;
    log.undo(); // takes back t-2, at a seq ABOVE that point

    const asItWas = new ProjectStore(false);
    replayEntries(
      asItWas,
      log.getEntries().filter((entry) => entry.seq <= beforeTheUndo),
    );
    expect(asItWas.getTracks().map((each) => each.id)).toEqual(["t-1", "t-2"]);

    const asItIs = new ProjectStore(false);
    replayEntries(asItIs, log.getEntries());
    expect(asItIs.getTracks().map((each) => each.id)).toEqual(["t-1"]);
  });

  it("applies an entry with no id, because nothing can name it to take it back", () => {
    const { log, edit } = seededLog();
    edit(track("t-1"));
    const entries = log.getEntries().map((entry) => ({ ...entry, id: undefined }));

    const replayed = new ProjectStore(false);
    replayEntries(replayed, entries);
    expect(replayed.getTracks().map((each) => each.id)).toEqual(["t-1"]);
  });
});

describe("loading a bundle honours its tombstones", () => {
  it("does not resurrect an edit that was undone before the tail was written", async () => {
    const repo = new ProjectRepository(new MemoryBundleStore(), "p-tomb");
    const { project, log, edit } = seededLog();
    edit(track("t-1"));
    await repo.save(project.snapshot(), log.getEntries(), log.getNotes());

    // An edit and an undo of it land AFTER the keyframe, and only the stream is appended - which is
    // what the page-hide flush does: it appends the tail without rewriting project.json.
    edit(track("t-2"));
    log.undo();
    await repo.appendEdits(log.getEntries(), log.getNotes());

    const loaded = await repo.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.project.tracks.map((each) => each.id)).toEqual(["t-1"]);
  });

  // The hard case: the tombstone takes back an edit the keyframe already has baked in, so replaying
  // forward from that keyframe cannot remove it. The base has to move back instead.
  it("goes back to a retained keyframe when the tombstone is below the head one", async () => {
    const repo = new ProjectRepository(new MemoryBundleStore(), "p-tomb-old");
    const { project, log, edit } = seededLog();
    edit(track("t-1"));
    // Keyframe at seq 0 and retained in the ring, so there is a base from before t-2 exists.
    await repo.save(project.snapshot(), log.getEntries(), log.getNotes());

    edit(track("t-2"));
    // Keyframe again: now project.json has t-2 baked in.
    await repo.save(project.snapshot(), log.getEntries(), log.getNotes());

    log.undo(); // takes back t-2, which the head keyframe already contains
    await repo.appendEdits(log.getEntries(), log.getNotes());

    const loaded = await repo.load();
    expect(loaded!.project.tracks.map((each) => each.id)).toEqual(["t-1"]);
  });
});
