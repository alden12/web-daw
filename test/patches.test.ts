import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { applyEdit } from '../src/audio/commands/applyEdit';
import { describeCommand } from '../src/audio/commands/describe';
import type { EditCommand } from '../src/audio/commands/types';
import { listPatches, savePatch, removePatch, newPatchId } from '../src/audio/patches/library';

// The patch library is localStorage-backed; the node test env has none, so install
// a minimal in-memory shim per test.
function installLocalStorage(): void {
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
}

const samplePatch = (over: Partial<Parameters<typeof savePatch>[0]> = {}) => ({
  id: newPatchId(),
  name: 'Warm Pad',
  author: 'you' as const,
  instrumentType: 'subtractive',
  params: { 'filter.cutoff': 1200 },
  effects: [{ type: 'delay', bypassed: false, params: { mix: 0.4 } }],
  createdAt: 1,
  ...over,
});

describe('patch library (global, localStorage-backed)', () => {
  beforeEach(() => installLocalStorage());
  afterEach(() => delete (globalThis as { localStorage?: Storage }).localStorage);

  it('saves, lists newest-first, and removes', () => {
    expect(listPatches()).toEqual([]);
    const a = samplePatch({ name: 'A' });
    const b = samplePatch({ name: 'B' });
    savePatch(a);
    savePatch(b);
    expect(listPatches().map((p) => p.name)).toEqual(['B', 'A']); // newest first

    removePatch(a.id);
    expect(listPatches().map((p) => p.name)).toEqual(['B']);
  });

  it('upserts by id rather than duplicating', () => {
    const p = samplePatch({ name: 'One' });
    savePatch(p);
    savePatch({ ...p, name: 'Renamed' });
    expect(listPatches()).toHaveLength(1);
    expect(listPatches()[0].name).toBe('Renamed');
  });

  it('degrades to an empty library when storage is unavailable', () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(listPatches()).toEqual([]);
  });
});

/** A createTrackFromPatch edit with fixed ids, so two applies are comparable. */
function patchCommand(): Extract<EditCommand, { type: 'createTrackFromPatch' }> {
  return {
    type: 'createTrackFromPatch',
    id: 't-patch',
    name: 'Warm Pad',
    instrumentType: 'subtractive',
    params: { 'filter.cutoff': 1234 },
    effects: [
      { id: 'fx-1', type: 'delay', bypassed: false, params: { mix: 0.4 } },
      { id: 'fx-2', type: 'reverb', bypassed: true, params: {} },
    ],
  };
}

describe('addTrackFromPatch (apply a patch as one edit)', () => {
  it('builds the instrument track with its params and effect chain', () => {
    const project = new ProjectStore(false);
    applyEdit(project, patchCommand(), 'you');

    const track = project.getTrack('t-patch');
    expect(track?.kind).toBe('instrument');
    expect(track?.name).toBe('Warm Pad');
    expect((track as { instrumentType: string }).instrumentType).toBe('subtractive');
    // Instrument param loaded from the patch.
    expect((track as { params: { get(id: string): unknown } }).params.get('filter.cutoff')).toBe(1234);

    // Effects added in order, with their ids, params, and bypass state.
    expect(project.getEffect('t-patch', 'fx-1')?.type).toBe('delay');
    expect(project.getEffect('t-patch', 'fx-1')?.params.get('mix')).toBe(0.4);
    expect(project.getEffect('t-patch', 'fx-2')?.type).toBe('reverb');
    expect(project.getEffect('t-patch', 'fx-2')?.bypassed).toBe(true);
  });

  it('is a pure function of the command: two fresh stores produce identical state (replayable)', () => {
    const a = new ProjectStore(false);
    const b = new ProjectStore(false);
    applyEdit(a, patchCommand(), 'you');
    applyEdit(b, patchCommand(), 'you');
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('is idempotent by track id (re-applying the same command does not duplicate)', () => {
    const project = new ProjectStore(false);
    applyEdit(project, patchCommand(), 'you');
    const once = project.snapshot();
    applyEdit(project, patchCommand(), 'you'); // same id -> no-op
    expect(project.snapshot()).toEqual(once);
  });

  it('describes nicely in the activity feed', () => {
    expect(describeCommand(patchCommand())).toBe('Added "Warm Pad" from the library');
  });
});
