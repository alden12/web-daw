import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { EditLog } from '../src/audio/commands/editLog';
import type { NoteEvent } from '../src/audio/sequencer/types';

const note = (over: Partial<NoteEvent> & { id: string }): NoteEvent => ({
  pitch: 60,
  start: 0,
  length: 1,
  velocity: 0.8,
  ...over,
});

function setup() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
  return { project, log };
}

const notesOf = (project: ProjectStore) =>
  (project.getTrack('t-1') as { clip: { getClip(): { notes: NoteEvent[]; lengthBeats: number } } }).clip.getClip();

const entriesOfType = (log: EditLog, type: string) => log.getState().entries.filter((e) => e.command.type === type);

describe('plural clip commands', () => {
  it('addNotes / removeNotes are one atomic edit each (not one per note)', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'addNotes', trackId: 't-1', notes: [note({ id: 'a' }), note({ id: 'b', start: 1 }), note({ id: 'c', start: 2 })] });
    expect(notesOf(project).notes).toHaveLength(3);
    expect(entriesOfType(log, 'addNotes')).toHaveLength(1);

    log.dispatch({ type: 'removeNotes', trackId: 't-1', ids: ['a', 'b'] });
    expect(notesOf(project).notes.map((n) => n.id)).toEqual(['c']);
    expect(entriesOfType(log, 'removeNotes')).toHaveLength(1);

    // one undo restores both removed notes
    log.undo();
    expect(notesOf(project).notes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('editNotes moves/resizes existing notes in place (by id), without adding', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'addNotes', trackId: 't-1', notes: [note({ id: 'a' }), note({ id: 'b', start: 1 })] });
    log.dispatch({ type: 'editNotes', trackId: 't-1', notes: [note({ id: 'a', start: 4, pitch: 67, length: 2 })] });

    const a = notesOf(project).notes.find((n) => n.id === 'a')!;
    expect(a.start).toBe(4);
    expect(a.pitch).toBe(67);
    expect(a.length).toBe(2);
    expect(notesOf(project).notes).toHaveLength(2); // edit, not add
  });

  it('coalesces a continuous editNotes drag (same id-set) into one entry + one undo step', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'addNotes', trackId: 't-1', notes: [note({ id: 'a' })] });
    log.dispatch({ type: 'editNotes', trackId: 't-1', notes: [note({ id: 'a', start: 1 })] });
    log.dispatch({ type: 'editNotes', trackId: 't-1', notes: [note({ id: 'a', start: 2 })] });
    log.dispatch({ type: 'editNotes', trackId: 't-1', notes: [note({ id: 'a', start: 3 })] });

    expect(entriesOfType(log, 'editNotes')).toHaveLength(1);
    expect(notesOf(project).notes[0].start).toBe(3);
    log.undo(); // reverts the whole drag back to the pre-drag position
    expect(notesOf(project).notes[0].start).toBe(0);
  });

  it('does not coalesce editNotes across different note sets', () => {
    const { log } = setup();
    log.dispatch({ type: 'addNotes', trackId: 't-1', notes: [note({ id: 'a' }), note({ id: 'b', start: 1 })] });
    log.dispatch({ type: 'editNotes', trackId: 't-1', notes: [note({ id: 'a', start: 2 })] });
    log.dispatch({ type: 'editNotes', trackId: 't-1', notes: [note({ id: 'b', start: 3 })] });
    expect(entriesOfType(log, 'editNotes')).toHaveLength(2);
  });
});

describe('setLength', () => {
  it('sets the project loop length and clamps notes that fall past the new end', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'addNotes', trackId: 't-1', notes: [note({ id: 'far', start: 12, length: 4 })] });
    expect(notesOf(project).notes[0].start).toBe(12);

    log.dispatch({ type: 'setLength', lengthBeats: 8 });
    expect(project.length).toBe(8);
    expect(notesOf(project).lengthBeats).toBe(8); // active clip kept in sync
    const far = notesOf(project).notes[0];
    expect(far.start).toBeLessThanOrEqual(8); // clamped inside the loop
    expect(far.start + far.length).toBeLessThanOrEqual(8);
  });

  it('coalesces a loop-handle drag into one undo step', () => {
    const { project, log } = setup();
    log.dispatch({ type: 'setLength', lengthBeats: 12 });
    log.dispatch({ type: 'setLength', lengthBeats: 8 });
    log.dispatch({ type: 'setLength', lengthBeats: 4 });
    expect(entriesOfType(log, 'setLength')).toHaveLength(1);
    expect(project.length).toBe(4);
    log.undo();
    expect(project.length).toBe(16); // back to the default loop length
  });
});
