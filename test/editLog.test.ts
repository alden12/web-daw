import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { EditLog } from '../src/audio/commands/editLog';

function setup() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  return { project, log };
}

describe('EditLog', () => {
  it('applies a command and records an authored, ordered entry', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'setTempo', bpm: 90 });
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' }, 'claude');

    expect(project.tempo).toBe(90);
    expect(project.getTrack('t-1')?.kind).toBe('instrument');

    const { entries } = log.getState();
    expect(entries.map((e) => e.command.type)).toEqual(['setTempo', 'createTrack']);
    expect(entries.map((e) => e.author)).toEqual(['you', 'claude']);
    expect(entries.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('undo/redo round-trips a structural edit', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-1' });
    expect(project.getTrack('t-1')).toBeTruthy();
    expect(log.getState().canUndo).toBe(true);

    log.undo();
    expect(project.getTrack('t-1')).toBeUndefined();
    expect(log.getState().canRedo).toBe(true);

    log.redo();
    expect(project.getTrack('t-1')?.instrumentType).toBe('fm');
  });

  it('undo reverts a parameter change and a note edit', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });

    log.dispatch({ type: 'setParam', trackId: 't-1', id: 'filter.cutoff', value: 1234 });
    expect((project.getTrack('t-1') as { params: { get(id: string): unknown } }).params.get('filter.cutoff')).toBe(1234);
    log.undo();
    expect((project.getTrack('t-1') as { params: { get(id: string): unknown } }).params.get('filter.cutoff')).toBe(4000);

    log.dispatch({ type: 'addNote', trackId: 't-1', note: { id: 'n-1', pitch: 60, start: 0, length: 1, velocity: 0.8 } });
    const clip = () => (project.getTrack('t-1') as { clip: { getClip(): { notes: unknown[] } } }).clip.getClip().notes;
    expect(clip()).toHaveLength(1);
    log.undo();
    expect(clip()).toHaveLength(0);
  });

  it('undoes a cascading group removal in one step', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'createGroup', id: 'g-1', name: 'Drums' });
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1', groupId: 'g-1' });
    expect(project.getTrack('t-1')?.parentId).toBe('g-1');

    log.dispatch({ type: 'removeGroup', groupId: 'g-1' });
    expect(project.getGroup('g-1')).toBeUndefined();
    expect(project.getTrack('t-1')).toBeUndefined();

    log.undo();
    expect(project.getGroup('g-1')?.name).toBe('Drums');
    expect(project.getTrack('t-1')?.parentId).toBe('g-1');
  });

  it('coalesces rapid edits to the same target into one step and one entry', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });

    log.dispatch({ type: 'setParam', trackId: 't-1', id: 'filter.cutoff', value: 1000 });
    log.dispatch({ type: 'setParam', trackId: 't-1', id: 'filter.cutoff', value: 2000 });
    log.dispatch({ type: 'setParam', trackId: 't-1', id: 'filter.cutoff', value: 3000 });

    const { entries } = log.getState();
    // createTrack + one coalesced setParam (not three)
    expect(entries).toHaveLength(2);
    const get = () => (project.getTrack('t-1') as { params: { get(id: string): unknown } }).params.get('filter.cutoff');
    expect(get()).toBe(3000);

    // a single undo reverts the whole drag back to the default
    log.undo();
    expect(get()).toBe(4000);
    expect(project.getTrack('t-1')).toBeTruthy(); // track still there
  });

  it('does not coalesce edits to different targets', () => {
    const { log } = setup();
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.dispatch({ type: 'setParam', trackId: 't-1', id: 'filter.cutoff', value: 1000 });
    log.dispatch({ type: 'setParam', trackId: 't-1', id: 'amp.level', value: 0.5 });
    expect(log.getState().entries.filter((e) => e.command.type === 'setParam')).toHaveLength(2);
  });

  it('clears the redo stack after a new edit', () => {
    const { log } = setup();
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-2' });
    log.undo();
    expect(log.getState().canRedo).toBe(true);
    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-3' });
    expect(log.getState().canRedo).toBe(false);
  });
});
