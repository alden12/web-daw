import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { EditLog } from '../src/audio/commands/editLog';
import { attachAutosave, restoreProject } from '../src/audio/persistence';
import { ProjectRepository } from '../src/audio/projectRepository';
import { MemoryBundleStore } from '../src/audio/bundleStore';
import type { ProjectData } from '../src/audio/project/types';

const MAX_PERSISTED_ENTRIES = 2000;
const V5_KEY = 'web-daw:project:v5';

// persistence/migration talk to localStorage; the unit env (node) has none, so
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

describe('EditLog.restore', () => {
  it('restores entries, continues seq monotonically, and resets undo/redo', () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.restore([
      { seq: 4, command: { type: 'setTempo', bpm: 100 }, author: 'you', time: 1 },
      { seq: 5, command: { type: 'createTrack', instrumentType: 'fm', id: 't-x' }, author: 'claude', time: 2 },
    ]);

    const state = log.getState();
    expect(state.entries.map((e) => e.seq)).toEqual([4, 5]);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);

    // A new edit continues from max(seq)+1.
    log.dispatch({ type: 'setTempo', bpm: 90 });
    expect(log.getState().entries.at(-1)?.seq).toBe(6);
  });

  it('restores feed notes and continues seq past the highest of both streams', () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.restore(
      [{ seq: 3, command: { type: 'setTempo', bpm: 100 }, author: 'you', time: 1 }],
      [{ seq: 7, text: 'warming up the pad', author: 'claude', time: 2 }],
    );

    expect(log.getNotes().map((n) => n.text)).toEqual(['warming up the pad']);
    expect(log.getState().notes).toHaveLength(1);

    // seq continues from max(entry 3, note 7) + 1, so the next note lands at 8.
    log.note('next move', 'claude');
    expect(log.getNotes().at(-1)?.seq).toBe(8);
  });
});

describe('project + edit-log persistence', () => {
  beforeEach(() => {
    installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    vi.useRealTimers();
  });

  it('round-trips the project state and the authored log through a save/restore', async () => {
    vi.useFakeTimers();
    // A fresh bundle (no legacy migration) shared by save and restore.
    const repo = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null });
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.dispatch({ type: 'setTempo', bpm: 90 }, 'claude');
    await vi.runAllTimersAsync(); // fire the debounced save and flush its writes
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, repo);

    // State restored from the snapshot.
    expect(project2.tempo).toBe(90);
    expect(project2.getTrack('t-1')?.kind).toBe('instrument');
    // Log restored for the feed/history.
    const entries = log2.getState().entries;
    expect(entries.map((e) => e.command.type)).toEqual(['createTrack', 'setTempo']);
    expect(entries.map((e) => e.author)).toEqual(['you', 'claude']);
  });

  it('persists a feed note posted with no following edit (saved via the log subscription)', async () => {
    vi.useFakeTimers();
    const repo = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null });
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    // A note changes no project state, so only the edit-log subscription can save it.
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.note('about to layer a pad on top', 'claude');
    await vi.runAllTimersAsync();
    dispose();
    vi.useRealTimers();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    await restoreProject(project2, log2, repo);
    expect(log2.getNotes().map((n) => n.text)).toEqual(['about to layer a pad on top']);
  });

  it('persists undo/redo so undo works after a restore (reload)', async () => {
    vi.useFakeTimers();
    const repo = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null });
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log, repo);

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.dispatch({ type: 'setTempo', bpm: 132 });
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

  it('delta-encoded undo/redo reproduces exact states through a reload', () => {
    const build = () => {
      const project = new ProjectStore(false);
      const log = new EditLog(project);
      log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
      log.dispatch({ type: 'setTempo', bpm: 100 });
      log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-2' });
      log.dispatch({ type: 'setTempo', bpm: 140 });
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
    const press = (op: 'undo' | 'redo') => {
      ref.log[op]();
      log2[op]();
      expect(project2.snapshot()).toEqual(ref.project.snapshot());
    };
    press('redo');
    press('redo');
    press('undo');
    press('undo');
    press('undo');
    press('undo');
  });

  it('still loads a legacy (full-snapshot) undo state', () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.dispatch({ type: 'setTempo', bpm: 137 });
    const snap = project.snapshot();

    // Pre-delta persisted form: arrays of full checkpoints.
    const legacy = { undo: [{ snap, command: { type: 'setTempo', bpm: 120 }, author: 'you' }], redo: [] };
    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    log2.restoreCheckpoints(legacy as unknown as Parameters<EditLog['restoreCheckpoints']>[0]);

    expect(log2.getState().canUndo).toBe(true);
    log2.undo();
    expect(project2.snapshot()).toEqual(snap); // the legacy snapshot loaded verbatim
  });

  it('trims the persisted log to the last MAX_PERSISTED_ENTRIES', async () => {
    vi.useFakeTimers();
    const repo = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null });
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    project.addTrack('subtractive', { id: 't-1' }); // direct (not logged)
    const fx = project.addEffect('t-1', 'delay')!; // direct (not logged)
    const dispose = attachAutosave(project, log, repo);

    // Non-coalescing edits to a tiny, stable project -> many cheap entries.
    for (let i = 0; i < MAX_PERSISTED_ENTRIES + 5; i++) {
      log.dispatch({ type: 'bypassEffect', hostId: 't-1', effectId: fx.id, bypassed: i % 2 === 0 });
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

  it('migrates a legacy v5 blob (no log) into a bundle with the project intact', async () => {
    // Build a v5-shaped blob: same project shape, but no `log` field.
    const raw = installLocalStorage();
    const seed = new ProjectStore(false);
    seed.addTrack('fm', { id: 't-legacy' });
    raw.set(V5_KEY, JSON.stringify({ version: 5, project: seed.snapshot() }));

    // Default loadLegacy reads the localStorage shim above; no bundle exists yet.
    const repo = new ProjectRepository(new MemoryBundleStore());
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    await restoreProject(project, log, repo);

    expect(project.getTrack('t-legacy')?.kind).toBe('instrument');
    expect(log.getState().entries).toEqual([]);

    // A second load now reads the migrated bundle (not the legacy blob).
    const reloaded = await repo.load();
    expect(reloaded?.project.tracks.map((t) => t.id)).toEqual(['t-legacy']);
  });

  it('migrates legacy au-* samples to content-addressed fileIds, deduped', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    // A minimal v7 project: two audio clips sharing one legacy sample id.
    const legacyProject = {
      groups: [],
      tempoBpm: 120,
      lengthBeats: 16,
      selectedTrackId: null,
      tracks: [
        {
          kind: 'audio',
          id: 't-a',
          name: 'Aud',
          parentId: 'master',
          muted: false,
          volume: 1,
          effects: [],
          placements: [],
          activeClipId: 'c-1',
          launchedClipId: null,
          clips: [
            { id: 'c-1', name: 'A', author: 'you', fileId: 'au-x', gain: 1, durationSec: 1 },
            { id: 'c-2', name: 'B', author: 'you', fileId: 'au-x', gain: 1, durationSec: 1 },
          ],
        },
      ],
    } as unknown as ProjectData;

    const reads: string[] = [];
    const repo = new ProjectRepository(new MemoryBundleStore(), {
      loadLegacy: () => ({ project: legacyProject, log: [], notes: [] }),
      legacySampleReader: async (id) => {
        reads.push(id);
        return id === 'au-x' ? bytes : null;
      },
    });

    const saved = await repo.load();
    const clips = (saved!.project.tracks[0] as { clips: { fileId: string }[] }).clips;

    // Both clips rewritten to the same sha256 hex (dedup); the source read once.
    expect(clips[0].fileId).not.toBe('au-x');
    expect(clips[0].fileId).toHaveLength(64);
    expect(clips[1].fileId).toBe(clips[0].fileId);
    expect(reads).toEqual(['au-x']);

    // The bytes are retrievable under the new content hash.
    const buf = await repo.getSample(clips[0].fileId);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array(bytes));
  });

  it('round-trips a project + samples through a portable bundle export/import', async () => {
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    const source = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null });
    const hash = await source.putSample(new Blob([bytes]));

    const project = {
      groups: [],
      tempoBpm: 128,
      lengthBeats: 16,
      selectedTrackId: null,
      tracks: [
        {
          kind: 'audio',
          id: 't-a',
          name: 'Aud',
          parentId: 'master',
          muted: false,
          volume: 1,
          effects: [],
          placements: [],
          activeClipId: 'c-1',
          launchedClipId: null,
          clips: [{ id: 'c-1', name: 'A', author: 'you', fileId: hash, gain: 1, durationSec: 1 }],
        },
      ],
    } as unknown as ProjectData;
    const log = [{ seq: 0, command: { type: 'setTempo', bpm: 128 }, author: 'you' as const, time: 1 }];
    const notes = [{ seq: 1, text: 'set the groove tempo', author: 'claude' as const, time: 2 }];

    const files = await source.exportBundle(project, log, notes);
    // Readable JSON entries plus the referenced sample as real .wav bytes.
    const proj = JSON.parse(new TextDecoder().decode(files['project.json'])) as ProjectData;
    expect(proj.tempoBpm).toBe(128);
    expect(files['notes.json']).toBeTruthy();
    expect(files[`samples/${hash}.wav`]).toBeTruthy();

    // Import into a brand-new, empty repository.
    const dest = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null });
    const restored = await dest.importBundle(files);
    expect(restored.project.tempoBpm).toBe(128);
    expect(restored.log.map((e) => e.command.type)).toEqual(['setTempo']);
    expect(restored.notes.map((n) => n.text)).toEqual(['set the groove tempo']);
    const sample = await dest.getSample(hash);
    expect(new Uint8Array(sample)).toEqual(new Uint8Array(bytes));
  });
});
