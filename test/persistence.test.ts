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
      loadLegacy: () => ({ project: legacyProject, log: [] }),
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
});
