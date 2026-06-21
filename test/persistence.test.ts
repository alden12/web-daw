import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { EditLog } from '../src/audio/commands/editLog';
import { attachAutosave, restoreProject } from '../src/audio/persistence';

const SAVE_DEBOUNCE_MS = 300;
const MAX_PERSISTED_ENTRIES = 2000;
const V5_KEY = 'web-daw:project:v5';

// The persistence module talks to localStorage; the unit env (node) has none, so
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
  let raw: Map<string, string>;
  beforeEach(() => {
    raw = installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    vi.useRealTimers();
  });

  it('round-trips the project state and the authored log through a save/restore', () => {
    vi.useFakeTimers();
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    const dispose = attachAutosave(project, log);

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.dispatch({ type: 'setTempo', bpm: 90 }, 'claude');
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 20);
    dispose();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    restoreProject(project2, log2);

    // State restored from the snapshot.
    expect(project2.tempo).toBe(90);
    expect(project2.getTrack('t-1')?.kind).toBe('instrument');
    // Log restored for the feed/history.
    const entries = log2.getState().entries;
    expect(entries.map((e) => e.command.type)).toEqual(['createTrack', 'setTempo']);
    expect(entries.map((e) => e.author)).toEqual(['you', 'claude']);
  });

  it('trims the persisted log to the last MAX_PERSISTED_ENTRIES', () => {
    vi.useFakeTimers();
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    project.addTrack('subtractive', { id: 't-1' }); // direct (not logged)
    const fx = project.addEffect('t-1', 'delay')!; // direct (not logged)
    const dispose = attachAutosave(project, log);

    // Non-coalescing edits to a tiny, stable project -> many cheap entries.
    for (let i = 0; i < MAX_PERSISTED_ENTRIES + 5; i++) {
      log.dispatch({ type: 'bypassEffect', hostId: 't-1', effectId: fx.id, bypassed: i % 2 === 0 });
    }
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 20);
    dispose();

    const project2 = new ProjectStore(false);
    const log2 = new EditLog(project2);
    restoreProject(project2, log2);
    expect(log2.getEntries()).toHaveLength(MAX_PERSISTED_ENTRIES);
    // The tail (most recent) is kept, not the head.
    expect(log2.getEntries().at(-1)?.seq).toBe(MAX_PERSISTED_ENTRIES + 4);
  });

  it('loads a legacy v5 blob (no log) with the project intact and an empty feed', () => {
    // Build a v5-shaped blob: same project shape, but no `log` field.
    const seed = new ProjectStore(false);
    seed.addTrack('fm', { id: 't-legacy' });
    raw.set(V5_KEY, JSON.stringify({ version: 5, project: seed.snapshot() }));

    const project = new ProjectStore(false);
    const log = new EditLog(project);
    restoreProject(project, log);

    expect(project.getTrack('t-legacy')?.kind).toBe('instrument');
    expect(log.getState().entries).toEqual([]);
  });
});
