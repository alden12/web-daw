import { describe, expect, it } from 'vitest';
import { beatsToSeconds, notesStartingInBeatRange, onsetsInBeatRange } from '../src/audio/sequencer/scheduler';
import type { NoteEvent } from '../src/audio/sequencer/types';

describe('onsetsInBeatRange (audio clip onsets)', () => {
  const LOOP = 4;
  it('reports a clip onset within the window and on each loop', () => {
    expect(onsetsInBeatRange(0, 0, 2, LOOP)).toEqual([0]);
    expect(onsetsInBeatRange(0, 3.5, 4.5, LOOP)).toEqual([4]); // next loop's onset
    expect(onsetsInBeatRange(2, 0, 4, LOOP)).toEqual([2]);
  });
  it('returns nothing for an empty/inverted range or non-positive loop', () => {
    expect(onsetsInBeatRange(0, 2, 2, LOOP)).toEqual([]);
    expect(onsetsInBeatRange(0, 3, 1, LOOP)).toEqual([]);
    expect(onsetsInBeatRange(0, 0, 4, 0)).toEqual([]);
  });
});

const note = (id: string, pitch: number, start: number): NoteEvent => ({
  id,
  pitch,
  start,
  length: 1,
  velocity: 0.8,
});

describe('beatsToSeconds', () => {
  it('converts at tempo', () => {
    expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5);
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2);
    expect(beatsToSeconds(1, 60)).toBeCloseTo(1);
  });
});

describe('notesStartingInBeatRange', () => {
  const notes = [note('a', 60, 0), note('b', 64, 2), note('c', 67, 3.5)];
  const LOOP = 4;

  it('selects notes whose onset falls in [from, to)', () => {
    const hits = notesStartingInBeatRange(notes, 0, 3, LOOP);
    expect(hits.map((h) => h.note.id)).toEqual(['a', 'b']);
    expect(hits.map((h) => h.atBeat)).toEqual([0, 2]);
  });

  it('is half-open: includes from, excludes to', () => {
    expect(notesStartingInBeatRange(notes, 2, 3.5, LOOP).map((h) => h.note.id)).toEqual(['b']);
  });

  it('wraps around the loop and reports continuous beats', () => {
    // window spanning the loop boundary: 3.4 .. 4.5 should catch c@3.5 then a@4.0
    const hits = notesStartingInBeatRange(notes, 3.4, 4.5, LOOP);
    expect(hits.map((h) => h.note.id)).toEqual(['c', 'a']);
    expect(hits.map((h) => h.atBeat)).toEqual([3.5, 4]);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(notesStartingInBeatRange(notes, 2, 2, LOOP)).toEqual([]);
    expect(notesStartingInBeatRange(notes, 3, 1, LOOP)).toEqual([]);
  });
});
