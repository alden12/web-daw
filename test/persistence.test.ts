import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { attachAutosave, restoreProject } from "../src/audio/persistence";
import { ProjectRepository } from "../src/audio/projectRepository";
import { MemoryBundleStore } from "../src/audio/bundleStore";
import type { ProjectData } from "../src/audio/project/types";

const MAX_PERSISTED_ENTRIES = 2000;

// Some persistence paths touch localStorage; the unit env (node) has none, so
// install a minimal in-memory shim per test.
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

// Minimal document/window shim (node env has neither) so the page-hide flush listeners register and
// can be fired. `hide()` flips visibility and dispatches visibilitychange to the captured handlers.
function installDomShim() {
  const listeners: Record<string, Set<EventListener>> = {};
  let visibility = "visible";
  const on = (type: string, handler: EventListener) => void (listeners[type] ??= new Set()).add(handler);
  const off = (type: string, handler: EventListener) => void listeners[type]?.delete(handler);
  (globalThis as unknown as { document: unknown }).document = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: on,
    removeEventListener: off,
  };
  (globalThis as unknown as { window: unknown }).window = { addEventListener: on, removeEventListener: off };
  return {
    hide: () => {
      visibility = "hidden";
      listeners["visibilitychange"]?.forEach((handler) => handler(new Event("visibilitychange")));
    },
    cleanup: () => {
      delete (globalThis as { document?: unknown }).document;
      delete (globalThis as { window?: unknown }).window;
    },
  };
}

describe("EditLog.restore", () => {
  it("restores entries, continues seq monotonically, and resets undo/redo", () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.restore([
      { seq: 4, command: { type: "setTempo", bpm: 100 }, author: "you", time: 1 },
      { seq: 5, command: { type: "createTrack", instrumentType: "fm", id: "t-x" }, author: "claude", time: 2 },
    ]);

    const state = log.getState();
    expect(state.entries.map((e) => e.seq)).toEqual([4, 5]);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);

    // A new edit continues from max(seq)+1.
    log.dispatch({ type: "setTempo", bpm: 90 });
    expect(log.getState().entries.at(-1)?.seq).toBe(6);
  });

  it("restores feed notes and continues seq past the highest of both streams", () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.restore(
      [{ seq: 3, command: { type: "setTempo", bpm: 100 }, author: "you", time: 1 }],
      [{ seq: 7, text: "warming up the pad", author: "claude", time: 2 }],
    );

    expect(log.getNotes().map((n) => n.text)).toEqual(["warming up the pad"]);
    expect(log.getState().notes).toHaveLength(1);

    // seq continues from max(entry 3, note 7) + 1, so the next note lands at 8.
    log.note("next move", "claude");
    expect(log.getNotes().at(-1)?.seq).toBe(8);
  });
});

describe("project + edit-log persistence", () => {
  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    vi.useRealTimers();
  });

  it("round-trips the project state and the authored log through a save/restore", async () => {
    vi.useFakeTimers();
    // A fresh bundle (no legacy migration) shared by save and restore.
    const repo = new ProjectRepository(new MemoryBundleStore());
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "setTempo", bpm: 90 }, "claude");
    await vi.runAllTimersAsync(); // fire the debounced save and flush its writes
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, repo);

    // State restored from the snapshot.
    expect(project2.tempo).toBe(90);
    expect(project2.getTrack("t-1")?.kind).toBe("instrument");
    // Log restored for the feed/history.
    const entries = log2.getState().entries;
    expect(entries.map((e) => e.command.type)).toEqual(["createTrack", "setTempo"]);
    expect(entries.map((e) => e.author)).toEqual(["you", "claude"]);
  });

  it("reconstructs HEAD from a keyframe plus a replayed edit tail", async () => {
    // Simulate a stale keyframe with edits appended after it (the delta case): the working state
    // on reload must equal the live snapshot, rebuilt by replaying the tail through applyEdit.
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);

    // Distinct-target edits (no coalescing), so seqs are stable and the keyframe is consistent.
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-2" });
    // Keyframe reflecting only the first two edits.
    await repo.writeKeyframe(project.snapshot(), log.getEntries().at(-1)!.seq);
    // Two more edits AFTER the keyframe - appended to the log, not folded into a new keyframe.
    log.dispatch({ type: "setTempo", bpm: 140 });
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-3" });
    await repo.appendEdits(log.getEntries());
    const live = project.snapshot();

    // Reload with a fresh repo over the same bundle.
    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, new ProjectRepository(store));

    expect(project2.snapshot()).toEqual(live); // keyframe + replayed tail == live HEAD
    expect(project2.tempo).toBe(140);
    expect(project2.getTrack("t-3")?.kind).toBe("instrument");
    // The feed still shows the whole authored history (keyframe's log.json + the tail).
    expect(log2.getEntries().map((e) => e.command.type)).toEqual([
      "createTrack",
      "createTrack",
      "setTempo",
      "createTrack",
    ]);
  });

  it("autosave forces a keyframe on undo, so a reload keeps the undone state (not the resurrected edit)", async () => {
    vi.useFakeTimers();
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "setTempo", bpm: 100 });
    await vi.runAllTimersAsync(); // keyframe reflecting both edits
    log.undo(); // tempo back to 120; appends a kind:"undo" entry (not replayable forward)
    await vi.runAllTimersAsync(); // autosave must FORCE a keyframe here
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, new ProjectRepository(store));
    // If the undo hadn't forced a keyframe, replaying the tail would skip it and resurrect bpm 100.
    expect(project2.tempo).toBe(120);
  });

  it("keeps project.json stable across an edit burst below the keyframe interval, still reconstructs on load", async () => {
    vi.useFakeTimers();
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    await vi.runAllTimersAsync(); // the first tick forces the initial keyframe
    const keyframeAfterFirst = repo.keyframeSeq();

    // A burst well below KEYFRAME_EDIT_INTERVAL: distinct-target edits (no coalescing).
    for (let i = 0; i < 10; i++) {
      log.dispatch({ type: "createTrack", instrumentType: "fm", id: `t-x${i}` });
    }
    await vi.runAllTimersAsync();
    // No fresh keyframe - the tail is short, so project.json still reflects the first keyframe's seq;
    // the burst lives only as appended deltas.
    expect(repo.keyframeSeq()).toBe(keyframeAfterFirst);
    const live = project.snapshot();
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, new ProjectRepository(store));
    expect(project2.snapshot()).toEqual(live); // keyframe + replayed tail == live HEAD
  });

  it("writes a fresh keyframe once the edit tail passes the interval", async () => {
    vi.useFakeTimers();
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    await vi.runAllTimersAsync();
    const keyframeAfterFirst = repo.keyframeSeq();

    // Well past KEYFRAME_EDIT_INTERVAL (100) so the count trigger fires a new keyframe.
    for (let i = 0; i < 120; i++) {
      log.dispatch({ type: "createTrack", instrumentType: "fm", id: `t-x${i}` });
    }
    await vi.runAllTimersAsync();
    expect(repo.keyframeSeq()).toBeGreaterThan(keyframeAfterFirst);
    dispose();
    vi.useRealTimers();
  });

  it("persists a feed note on the fast cadence, without forcing a keyframe", async () => {
    vi.useFakeTimers();
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    await vi.runAllTimersAsync(); // initial keyframe
    const keyframeSeq = repo.keyframeSeq();

    log.note("layering a pad on top", "claude"); // no project edit; below the interval
    await vi.runAllTimersAsync();
    expect(repo.keyframeSeq()).toBe(keyframeSeq); // the note did NOT trigger a keyframe
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, new ProjectRepository(store));
    expect(log2.getNotes().map((n) => n.text)).toEqual(["layering a pad on top"]); // durable via notes.json
  });

  it("flushes the pending edit burst on page-hide, before the debounce fires", async () => {
    vi.useFakeTimers();
    const dom = installDomShim();
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    await vi.runAllTimersAsync(); // initial keyframe + manifest, so a reload has a starting point

    // A further edit whose debounce is still pending - nothing appended yet.
    log.dispatch({ type: "setTempo", bpm: 145 });
    dom.hide(); // page-hide -> flush the tail immediately
    await vi.runAllTimersAsync(); // let the flush's fire-and-forget writes settle
    dispose();
    dom.cleanup();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, new ProjectRepository(store));
    expect(project2.tempo).toBe(145); // the pending edit survived via the page-hide flush
  });

  it("persists a feed note posted with no following edit (saved via the log subscription)", async () => {
    vi.useFakeTimers();
    const repo = new ProjectRepository(new MemoryBundleStore());
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    // A note changes no project state, so only the edit-log subscription can save it.
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.note("about to layer a pad on top", "claude");
    await vi.runAllTimersAsync();
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, repo);
    expect(log2.getNotes().map((n) => n.text)).toEqual(["about to layer a pad on top"]);
  });

  it("folds feed notes into the unified stream (no separate notes.json) and round-trips them", async () => {
    vi.useFakeTimers();
    const store = new MemoryBundleStore();
    const repo = new ProjectRepository(store);
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.note("layering a pad", "claude");
    await vi.runAllTimersAsync();
    dispose();
    vi.useRealTimers();

    // The note is an entry in the append stream (kind:"note"), not a notes.json blob.
    expect(await store.readText("notes.json")).toBeNull();
    const stream = JSON.parse((await store.readText("edits.json"))!) as Array<{
      kind?: string;
      command: { type: string; text?: string };
    }>;
    expect(stream.some((entry) => entry.kind === "note" && entry.command.text === "layering a pad")).toBe(true);

    // It round-trips back into the feed on reload, split from the edits.
    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, new ProjectRepository(store));
    expect(log2.getNotes().map((n) => n.text)).toEqual(["layering a pad"]);
    expect(log2.getEntries().map((e) => e.command.type)).toEqual(["createTrack"]);
  });

  it("persists undo/redo so undo works after a restore (reload)", async () => {
    vi.useFakeTimers();
    const repo = new ProjectRepository(new MemoryBundleStore());
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "setTempo", bpm: 132 });
    await vi.runAllTimersAsync(); // save project + log + undo state
    dispose();
    vi.useRealTimers();

    // Fresh stores (simulate reload), same repo.
    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, repo);

    expect(log2.getState().canUndo).toBe(true); // undo survived the reload
    expect(project2.tempo).toBe(132);
    log2.undo();
    expect(project2.tempo).toBe(120); // back to before the tempo edit
  });

  it("delta-encoded undo/redo reproduces exact states through a reload", () => {
    const build = () => {
      const project = new ProjectStore(false);
      const log = new EditLog(project);
      log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
      log.dispatch({ type: "setTempo", bpm: 100 });
      log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-2" });
      log.dispatch({ type: "setTempo", bpm: 140 });
      return { project, log };
    };

    // Reference timeline (never persisted) vs one round-tripped through pack/unpack.
    const ref = build();
    ref.log.undo();
    ref.log.undo(); // populates a redo stack too

    const src = build();
    src.log.undo();
    src.log.undo();
    const packed = src.log.getCheckpoints();
    // The base snapshot is the bottom of the undo chain, not one-per-checkpoint.
    expect(packed.undo.base).toBeTruthy();
    expect(packed.undo.steps.length).toBeGreaterThan(1);

    const project2 = new ProjectStore(false);
    project2.load(src.project.snapshot()); // working state, as project.json would carry it
    const log2 = new EditLog(project2);
    log2.restoreCheckpoints(packed);

    expect(project2.snapshot()).toEqual(ref.project.snapshot());

    // Under the same presses, the reloaded timeline must track the reference exactly.
    const press = (op: "undo" | "redo") => {
      ref.log[op]();
      log2[op]();
      expect(project2.snapshot()).toEqual(ref.project.snapshot());
    };
    press("redo");
    press("redo");
    press("undo");
    press("undo");
    press("undo");
    press("undo");
  });

  it("trims the persisted log to the last MAX_PERSISTED_ENTRIES", async () => {
    vi.useFakeTimers();
    const repo = new ProjectRepository(new MemoryBundleStore());
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    project.addTrack("subtractive", { id: "t-1" }); // direct (not logged)
    const fx = project.addEffect("t-1", "delay")!; // direct (not logged)
    const dispose = attachAutosave(project, log, repo);

    // Non-coalescing edits to a tiny, stable project -> many cheap entries.
    for (let i = 0; i < MAX_PERSISTED_ENTRIES + 5; i++) {
      log.dispatch({ type: "bypassEffect", hostId: "t-1", effectId: fx.id, bypassed: i % 2 === 0 });
    }
    await vi.runAllTimersAsync();
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, repo);
    expect(log2.getEntries()).toHaveLength(MAX_PERSISTED_ENTRIES);
    // The tail (most recent) is kept, not the head.
    expect(log2.getEntries().at(-1)?.seq).toBe(MAX_PERSISTED_ENTRIES + 4);
  });

  it("round-trips a project + samples through a portable bundle export/import", async () => {
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    const source = new ProjectRepository(new MemoryBundleStore());
    const hash = await source.putSample(new Blob([bytes]));

    const project = {
      groups: [],
      tempoBpm: 128,
      lengthBeats: 16,
      selectedTrackId: null,
      tracks: [
        {
          kind: "audio",
          id: "t-a",
          name: "Aud",
          parentId: "master",
          muted: false,
          volume: 1,
          effects: [],
          placements: [],
          activeClipId: "c-1",
          launchedClipId: null,
          clips: [{ id: "c-1", name: "A", author: "you", fileId: hash, gain: 1, durationSec: 1 }],
        },
      ],
    } as unknown as ProjectData;
    const log = [{ seq: 0, command: { type: "setTempo", bpm: 128 }, author: "you" as const, time: 1 }];
    const notes = [{ seq: 1, text: "set the groove tempo", author: "claude" as const, time: 2 }];

    const files = await source.exportBundle(project, log, notes);
    // Readable JSON entries plus the referenced sample as real .wav bytes. The unified stream
    // (edits.json) carries the edit and the feed note (as a kind:"note" entry), ordered by seq.
    const proj = JSON.parse(new TextDecoder().decode(files["project.json"])) as ProjectData;
    expect(proj.tempoBpm).toBe(128);
    const stream = JSON.parse(new TextDecoder().decode(files["edits.json"])) as Array<{
      seq: number;
      kind?: string;
      command: { type: string; text?: string };
    }>;
    expect(stream.map((entry) => entry.seq)).toEqual([0, 1]);
    expect(stream[1]).toMatchObject({ kind: "note", command: { type: "note", text: "set the groove tempo" } });
    expect(files["notes.json"]).toBeUndefined(); // retired: notes live in the stream now
    expect(files[`samples/${hash}.wav`]).toBeTruthy();

    // Import into a brand-new, empty repository.
    const dest = new ProjectRepository(new MemoryBundleStore());
    const restored = await dest.importBundle(files);
    expect(restored.project.tempoBpm).toBe(128);
    expect(restored.log.map((e) => e.command.type)).toEqual(["setTempo"]);
    expect(restored.notes.map((n) => n.text)).toEqual(["set the groove tempo"]);
    const sample = await dest.getSample(hash);
    expect(new Uint8Array(sample)).toEqual(new Uint8Array(bytes));
  });
});
