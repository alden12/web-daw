import { describe, expect, it } from 'vitest';
import { ProjectStore, type InstrumentTrack } from '../src/audio/project/projectStore';
import type { ProjectData } from '../src/audio/project/types';
import { EditLog } from '../src/audio/commands/editLog';

/** A track seeded with one default variant; returns the store + a typed accessor. */
function trackWithVariant() {
  const project = new ProjectStore(false);
  const id = project.addTrack('subtractive', { id: 't-1' }).id;
  const inst = (): InstrumentTrack => {
    const t = project.getTrack(id);
    if (t?.kind !== 'instrument') throw new Error('expected instrument track');
    return t;
  };
  return { project, id, inst };
}

// A monotonic counter so test-assigned variant ids are unique without Math.random/Date.
let counter = 0;
/** Dispatch addVariant through the log (id assigned at the call site) and return the new id. */
function dispatchAddVariant(log: EditLog, trackId: string): string {
  const id = `v-test-${(counter += 1)}`;
  log.dispatch({ type: 'addVariant', trackId, id });
  return id;
}

describe('clip variants', () => {
  it('seeds a new track with one default variant', () => {
    const { inst } = trackWithVariant();
    const t = inst();
    expect(t.variants).toHaveLength(1);
    expect(t.activeVariantId).toBe(t.variants[0].id);
    expect(t.variants[0]).toMatchObject({ name: 'A', author: 'you' });
  });

  it('addVariant forks the active variant with a new id + author and makes it active', () => {
    const { project, id, inst } = trackWithVariant();
    const firstId = inst().activeVariantId;

    const created = project.addVariant(id, { author: 'claude' });
    expect(created).toBeTruthy();
    const t = inst();
    expect(t.variants).toHaveLength(2);
    expect(created!.id).not.toBe(firstId);
    expect(t.activeVariantId).toBe(created!.id);
    expect(t.variants.find((v) => v.id === created!.id)?.author).toBe('claude');
    expect(t.variants.find((v) => v.id === created!.id)?.name).toBe('B');
  });

  it('edits on a fork do not leak into the original (fold on switch)', () => {
    const { project, id, inst } = trackWithVariant();
    const firstId = inst().activeVariantId;

    const fork = project.addVariant(id)!;
    inst().clip.addNote({ pitch: 64, start: 0 });
    inst().params.set('filter.cutoff', 800);

    // Switch back to the original: it must be untouched.
    project.selectVariant(id, firstId);
    expect(inst().activeVariantId).toBe(firstId);
    expect(inst().clip.getClip().notes).toHaveLength(0);
    expect(inst().params.get('filter.cutoff')).toBe(4000);

    // Switch to the fork: its edits are materialized into the live stores.
    project.selectVariant(id, fork.id);
    expect(inst().clip.getClip().notes).toHaveLength(1);
    expect(inst().params.get('filter.cutoff')).toBe(800);
  });

  it('variant bundles the effect chain - switching morphs the effects', () => {
    const { project, id, inst } = trackWithVariant();
    const firstId = inst().activeVariantId;

    const fork = project.addVariant(id)!;
    const fx = project.addEffect(id, 'delay')!; // added to the live (active = fork) chain
    expect(inst().effects).toHaveLength(1);

    project.selectVariant(id, firstId);
    expect(inst().effects).toHaveLength(0); // original had no effects

    project.selectVariant(id, fork.id);
    expect(inst().effects.map((e) => e.id)).toEqual([fx.id]);
  });

  it('removeVariant refuses the last and reassigns active when removing the active one', () => {
    const { project, id, inst } = trackWithVariant();
    const firstId = inst().activeVariantId;

    project.removeVariant(id, firstId); // only variant - refused
    expect(inst().variants).toHaveLength(1);

    const fork = project.addVariant(id)!; // fork is now active
    project.removeVariant(id, fork.id);
    expect(inst().variants).toHaveLength(1);
    expect(inst().activeVariantId).toBe(firstId); // reassigned to the survivor
  });

  it('reuses the same child store instances across selectVariant and undo (bindings survive)', () => {
    const { project, id, inst } = trackWithVariant();
    const log = new EditLog(project);
    const params0 = inst().params;
    const clip0 = inst().clip;

    dispatchAddVariant(log, id);
    expect(inst().params).toBe(params0); // in-place: same instance
    expect(inst().clip).toBe(clip0);

    log.dispatch({ type: 'selectVariant', trackId: id, variantId: inst().variants[0].id });
    expect(inst().params).toBe(params0);

    log.undo(); // load() must reuse stores, not rebuild them
    expect(inst().params).toBe(params0);
    expect(inst().clip).toBe(clip0);
  });

  it('undo/redo round-trips addVariant and selectVariant', () => {
    const { project, id, inst } = trackWithVariant();
    const log = new EditLog(project);
    const firstId = inst().activeVariantId;

    const forkId = dispatchAddVariant(log, id);
    expect(inst().variants).toHaveLength(2);
    expect(inst().activeVariantId).toBe(forkId);

    log.undo();
    expect(inst().variants).toHaveLength(1);
    expect(inst().activeVariantId).toBe(firstId);

    log.redo();
    expect(inst().variants).toHaveLength(2);
    expect(inst().activeVariantId).toBe(forkId);
  });

  it('seeds the default variant id deterministically from the track id (browser/MCP agree)', () => {
    // addTrack runs independently on the browser and the MCP mirror; given the
    // same (wire-agreed) track id, both must seed the same default-variant id, or
    // variant tools would address a variant the other end never created.
    const browser = new ProjectStore(false);
    const mirror = new ProjectStore(false);
    const a = browser.addTrack('subtractive', { id: 't-shared' });
    const b = mirror.addTrack('subtractive', { id: 't-shared' });
    expect(a.kind === 'instrument' && a.variants[0].id).toBe(b.kind === 'instrument' && b.variants[0].id);
    expect(a.kind === 'instrument' && a.activeVariantId).toBe('v-t-shared');
  });

  it('migrates a legacy v4 track (no variants) into one default variant', () => {
    const legacy = {
      groups: [],
      tracks: [
        {
          id: 't-legacy',
          name: 'Old',
          parentId: '',
          muted: false,
          volume: 0.8,
          kind: 'instrument',
          instrumentType: 'subtractive',
          params: { 'filter.cutoff': 1234 },
          clip: { notes: [{ id: 'n1', pitch: 60, start: 0, length: 1, velocity: 0.8 }], lengthBeats: 16 },
          effects: [],
        },
      ],
      tempoBpm: 120,
      lengthBeats: 16,
      selectedTrackId: 't-legacy',
    } as unknown as ProjectData;

    const project = new ProjectStore(false);
    project.load(legacy);
    const t = project.getTrack('t-legacy');
    if (t?.kind !== 'instrument') throw new Error('expected instrument');
    expect(t.variants).toHaveLength(1);
    expect(t.activeVariantId).toBe(t.variants[0].id);
    expect(t.clip.getClip().notes).toHaveLength(1);
    expect(t.params.get('filter.cutoff')).toBe(1234);
  });

  it('round-trips variants through snapshot/load', () => {
    const { project, id, inst } = trackWithVariant();
    project.addVariant(id, { author: 'claude' });
    inst().params.set('filter.cutoff', 2200);

    const snap = project.snapshot();
    const restored = new ProjectStore(false);
    restored.load(snap);
    const t = restored.getTrack(id);
    if (t?.kind !== 'instrument') throw new Error('expected instrument');
    expect(t.variants).toHaveLength(2);
    expect(t.variants.some((v) => v.author === 'claude')).toBe(true);
    expect(t.params.get('filter.cutoff')).toBe(2200);
  });
});
