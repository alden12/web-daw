import { describe, expect, it } from 'vitest';
import { ProjectStore, type InstrumentTrack } from '../src/audio/project/projectStore';
import type { ProjectData } from '../src/audio/project/types';
import { EditLog } from '../src/audio/commands/editLog';

/** A track seeded with one default clip; returns the store + a typed accessor. */
function trackWithClip() {
  const project = new ProjectStore(false);
  const id = project.addTrack('subtractive', { id: 't-1' }).id;
  const inst = (): InstrumentTrack => {
    const t = project.getTrack(id);
    if (t?.kind !== 'instrument') throw new Error('expected instrument track');
    return t;
  };
  return { project, id, inst };
}

describe('clip pool', () => {
  it('seeds a new track with one default clip and one placement at beat 0', () => {
    const { inst } = trackWithClip();
    const t = inst();
    expect(t.clips).toHaveLength(1);
    expect(t.activeClipId).toBe(t.clips[0].id);
    expect(t.clips[0]).toMatchObject({ name: 'A', author: 'you' });
    expect(t.placements).toHaveLength(1);
    expect(t.placements[0]).toMatchObject({ clipId: t.clips[0].id, startBeat: 0 });
  });

  it('addClip copies the active clip into a new one (id + author) and makes it active', () => {
    const { project, id, inst } = trackWithClip();
    inst().clips[0].store.addNote({ pitch: 60, start: 0 });
    const created = project.addClip(id, { author: 'claude' });
    const t = inst();
    expect(t.clips).toHaveLength(2);
    expect(t.activeClipId).toBe(created!.id);
    expect(created!.author).toBe('claude');
    expect(created!.name).toBe('B');
    // copied the notes, but into an independent store
    expect(created!.store.getClip().notes).toHaveLength(1);
  });

  it('addClip with empty starts fresh and honours lengthBeats', () => {
    const { project, id, inst } = trackWithClip();
    inst().clips[0].store.addNote({ pitch: 60, start: 0 });
    const created = project.addClip(id, { empty: true, lengthBeats: 3 })!;
    expect(created.store.getClip().notes).toHaveLength(0); // did not copy the active clip
    expect(created.store.getClip().lengthBeats).toBe(3);
    expect(inst().activeClipId).toBe(created.id);
  });

  it('clips have independent stores - editing one does not affect another', () => {
    const { project, id, inst } = trackWithClip();
    const a = inst().clips[0];
    const b = project.addClip(id)!;
    b.store.addNote({ pitch: 67, start: 1 });
    expect(a.store.getClip().notes).toHaveLength(0);
    expect(b.store.getClip().notes).toHaveLength(1);
  });

  it('selectClip changes the active clip (navigation, no fold needed)', () => {
    const { project, id, inst } = trackWithClip();
    const first = inst().activeClipId;
    const b = project.addClip(id)!;
    expect(inst().activeClipId).toBe(b.id);
    project.selectClip(id, first);
    expect(inst().activeClipId).toBe(first);
  });

  it('removeClip refuses the last, drops the clip\'s placements, and reassigns active', () => {
    const { project, id, inst } = trackWithClip();
    const first = inst().activeClipId;
    project.removeClip(id, first); // only clip - refused
    expect(inst().clips).toHaveLength(1);

    const b = project.addClip(id)!; // now active
    project.addPlacement(id, { clipId: b.id, startBeat: 4 });
    expect(inst().placements.some((p) => p.clipId === b.id)).toBe(true);

    project.removeClip(id, b.id);
    expect(inst().clips).toHaveLength(1);
    expect(inst().activeClipId).toBe(first);
    expect(inst().placements.some((p) => p.clipId === b.id)).toBe(false); // placements pruned
  });

  it('reuses the track\'s ParamStore instance across load/undo (engine binding survives)', () => {
    const { project, id, inst } = trackWithClip();
    const log = new EditLog(project);
    const params0 = inst().params;
    log.dispatch({ type: 'addClip', trackId: id, id: 'c-x' });
    expect(inst().params).toBe(params0); // addClip does not touch the sound
    log.undo();
    expect(inst().params).toBe(params0); // load() reuses the param store
  });

  it('seeds the default clip + placement ids deterministically from the track id', () => {
    // addTrack runs independently on the browser and the MCP mirror; given the same
    // track id, both must seed the same clip/placement ids, or tools would address
    // something the other end never created.
    const a = new ProjectStore(false).addTrack('subtractive', { id: 't-shared' });
    const b = new ProjectStore(false).addTrack('subtractive', { id: 't-shared' });
    if (a.kind !== 'instrument' || b.kind !== 'instrument') throw new Error('instrument');
    expect(a.clips[0].id).toBe(b.clips[0].id);
    expect(a.clips[0].id).toBe('c-t-shared');
    expect(a.placements[0].id).toBe('p-t-shared');
  });
});

describe('placements', () => {
  it('adds, moves, removes and splits placements', () => {
    const { project, id, inst } = trackWithClip();
    const clipId = inst().activeClipId;
    const p = project.addPlacement(id, { clipId, startBeat: 8, length: 4 })!;
    expect(inst().placements).toHaveLength(2); // seed + new

    project.movePlacement(id, p.id, 12);
    expect(inst().placements.find((x) => x.id === p.id)?.startBeat).toBe(12);

    project.splitPlacement(id, p.id, 14, 'p-right');
    const left = inst().placements.find((x) => x.id === p.id)!;
    const right = inst().placements.find((x) => x.id === 'p-right')!;
    expect(left.length).toBe(2); // 14 - 12
    expect(right).toMatchObject({ startBeat: 14, offset: 2, length: 2 });

    project.removePlacement(id, 'p-right');
    expect(inst().placements.some((x) => x.id === 'p-right')).toBe(false);
  });
});

describe('clip launching', () => {
  it('launchClip sets / replaces / clears, validating the clip exists', () => {
    const { project, id, inst } = trackWithClip();
    const b = project.addClip(id, { empty: true })!;
    project.launchClip(id, b.id);
    expect(inst().launchedClipId).toBe(b.id);
    project.launchClip(id, 'nope'); // unknown clip -> cleared
    expect(inst().launchedClipId).toBe(null);
    project.launchClip(id, b.id);
    project.launchClip(id, null); // explicit stop
    expect(inst().launchedClipId).toBe(null);
  });

  it('stopAllClips clears every track', () => {
    const { project, id, inst } = trackWithClip();
    project.launchClip(id, inst().activeClipId);
    expect(inst().launchedClipId).not.toBe(null);
    project.stopAllClips();
    expect(inst().launchedClipId).toBe(null);
  });

  it('persists the launched clip across snapshot/load and drops a dangling ref', () => {
    const { project, id, inst } = trackWithClip();
    const clipId = inst().activeClipId;
    project.launchClip(id, clipId);

    const p2 = new ProjectStore(false);
    p2.load(project.snapshot());
    expect(p2.getTrack(id)!.launchedClipId).toBe(clipId);

    const snap = project.snapshot();
    const broken = { ...snap, tracks: snap.tracks.map((t) => ({ ...t, launchedClipId: 'gone' })) };
    const p3 = new ProjectStore(false);
    p3.load(broken);
    expect(p3.getTrack(id)!.launchedClipId).toBe(null);
  });
});

describe('clip copy/paste', () => {
  it('pasteClip adds instrument content as a new active clip', () => {
    const { project, id, inst } = trackWithClip();
    project.pasteClip(id, 'c-paste', {
      kind: 'instrument',
      name: 'Copy',
      notes: [{ id: 'n1', pitch: 64, start: 0, length: 1, velocity: 0.8 }],
      lengthBeats: 8,
    });
    const t = inst();
    expect(t.clips).toHaveLength(2);
    expect(t.activeClipId).toBe('c-paste');
    const pasted = t.clips.find((c) => c.id === 'c-paste')!;
    expect(pasted.name).toBe('Copy');
    expect(pasted.store.getClip().notes).toHaveLength(1);
    expect(pasted.store.getClip().lengthBeats).toBe(8);
  });

  it('pastes across same-kind tracks without touching the source', () => {
    const project = new ProjectStore(false);
    const a = project.addTrack('subtractive', { id: 't-a' }).id;
    const b = project.addTrack('subtractive', { id: 't-b' }).id;
    project.pasteClip(b, 'c-x', { kind: 'instrument', name: 'FromA', notes: [], lengthBeats: 4 });
    expect(project.getTrack(b)!.clips.some((c) => c.id === 'c-x')).toBe(true);
    expect(project.getTrack(b)!.activeClipId).toBe('c-x');
    expect(project.getTrack(a)!.clips.some((c) => c.id === 'c-x')).toBe(false);
  });

  it('refuses a cross-type paste (instrument content into an audio track)', () => {
    const project = new ProjectStore(false);
    const aud = project.addAudioTrack({ fileId: 'f1', name: 'Aud', durationSec: 2 }).id;
    const before = project.getTrack(aud)!.clips.length;
    project.pasteClip(aud, 'c-x', { kind: 'instrument', name: 'X', notes: [], lengthBeats: 4 });
    expect(project.getTrack(aud)!.clips.length).toBe(before);
  });
});

describe('migration', () => {
  it('migrates a v6 variant track into a clip pool + one placement, sound from the active variant', () => {
    const v6 = {
      groups: [],
      tracks: [
        {
          id: 't-v6',
          name: 'Old',
          parentId: '',
          muted: false,
          volume: 0.8,
          kind: 'instrument',
          instrumentType: 'subtractive',
          activeVariantId: 'v-2',
          variants: [
            { id: 'v-1', name: 'A', author: 'you', clip: { notes: [], lengthBeats: 16 }, params: { 'filter.cutoff': 1000 }, effects: [] },
            {
              id: 'v-2',
              name: 'B',
              author: 'claude',
              clip: { notes: [{ id: 'n1', pitch: 60, start: 0, length: 1, velocity: 0.8 }], lengthBeats: 16 },
              params: { 'filter.cutoff': 2200 },
              effects: [],
            },
          ],
        },
      ],
      tempoBpm: 120,
      lengthBeats: 16,
      selectedTrackId: 't-v6',
    } as unknown as ProjectData;

    const project = new ProjectStore(false);
    project.load(v6);
    const t = project.getTrack('t-v6');
    if (t?.kind !== 'instrument') throw new Error('expected instrument');
    expect(t.clips.map((c) => c.id)).toEqual(['v-1', 'v-2']);
    expect(t.activeClipId).toBe('v-2');
    expect(t.params.get('filter.cutoff')).toBe(2200); // sound from the active variant
    expect(t.placements).toHaveLength(1);
    expect(t.placements[0].clipId).toBe('v-2');
  });

  it('migrates a v4 single-clip track into one clip', () => {
    const v4 = {
      groups: [],
      tracks: [
        {
          id: 't-v4',
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
      selectedTrackId: 't-v4',
    } as unknown as ProjectData;

    const project = new ProjectStore(false);
    project.load(v4);
    const t = project.getTrack('t-v4');
    if (t?.kind !== 'instrument') throw new Error('expected instrument');
    expect(t.clips).toHaveLength(1);
    expect(t.clips[0].store.getClip().notes).toHaveLength(1);
    expect(t.params.get('filter.cutoff')).toBe(1234);
    expect(t.placements).toHaveLength(1);
  });

  it('round-trips clips + placements + track sound through snapshot/load', () => {
    const { project, id, inst } = trackWithClip();
    project.addClip(id, { author: 'claude' });
    inst().params.set('filter.cutoff', 2200);
    project.addPlacement(id, { startBeat: 8 });

    const restored = new ProjectStore(false);
    restored.load(project.snapshot());
    const t = restored.getTrack(id);
    if (t?.kind !== 'instrument') throw new Error('expected instrument');
    expect(t.clips).toHaveLength(2);
    expect(t.clips.some((c) => c.author === 'claude')).toBe(true);
    expect(t.params.get('filter.cutoff')).toBe(2200);
    expect(t.placements).toHaveLength(2);
  });
});
