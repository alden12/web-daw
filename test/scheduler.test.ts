import { describe, expect, it } from "vitest";
import {
  beatsToSeconds,
  metronomeClicksInBeatRange,
  notesStartingInBeatRange,
  onsetsInBeatRange,
  tileClipNotes,
} from "../src/audio/sequencer/scheduler";
import type { NoteEvent } from "../src/audio/sequencer/types";

describe("metronomeClicksInBeatRange", () => {
  it("clicks on each whole beat in the half-open range, accenting the bar", () => {
    expect(metronomeClicksInBeatRange(0, 4, 0, 16, 4)).toEqual([
      { atBeat: 0, accent: true },
      { atBeat: 1, accent: false },
      { atBeat: 2, accent: false },
      { atBeat: 3, accent: false },
    ]);
  });
  it("accents every bar boundary (downbeat) across bars", () => {
    expect(
      metronomeClicksInBeatRange(0, 8, 0, 16, 4)
        .filter((c) => c.accent)
        .map((c) => c.atBeat),
    ).toEqual([0, 4]);
  });
  it("accents on the time-signature's beats per bar (3/4 downbeats every 3)", () => {
    expect(
      metronomeClicksInBeatRange(0, 9, 0, 12, 3)
        .filter((c) => c.accent)
        .map((c) => c.atBeat),
    ).toEqual([0, 3, 6]);
  });
  it("maps continuous beats through the loop so accents follow the loop start", () => {
    // loopLen 4 from 0: continuous beats 4,5 wrap to musical 0,1 -> beat 4 accents.
    expect(metronomeClicksInBeatRange(4, 6, 0, 4, 4)).toEqual([
      { atBeat: 4, accent: true },
      { atBeat: 5, accent: false },
    ]);
  });
  it("offsets the musical beat by a non-zero loop start", () => {
    // loopStart 2, loopLen 4: continuous beat 2 -> musical 2+(2%4)=4 -> accent (bar).
    expect(metronomeClicksInBeatRange(2, 3, 2, 4, 4)).toEqual([{ atBeat: 2, accent: true }]);
  });
  it("starts at the first whole beat at or after a fractional from", () => {
    expect(metronomeClicksInBeatRange(1.5, 4, 0, 16, 4).map((c) => c.atBeat)).toEqual([2, 3]);
  });
  it("returns nothing for an empty/inverted range or non-positive loop/bar", () => {
    expect(metronomeClicksInBeatRange(2, 2, 0, 16, 4)).toEqual([]);
    expect(metronomeClicksInBeatRange(0, 4, 0, 0, 4)).toEqual([]);
    expect(metronomeClicksInBeatRange(0, 4, 0, 16, 0)).toEqual([]);
  });
});

describe("onsetsInBeatRange (audio clip onsets)", () => {
  const LOOP = 4;
  it("reports a clip onset within the window and on each loop", () => {
    expect(onsetsInBeatRange(0, 0, 2, LOOP)).toEqual([0]);
    expect(onsetsInBeatRange(0, 3.5, 4.5, LOOP)).toEqual([4]); // next loop's onset
    expect(onsetsInBeatRange(2, 0, 4, LOOP)).toEqual([2]);
  });
  it("returns nothing for an empty/inverted range or non-positive loop", () => {
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

describe("tileClipNotes (placement windowing + looping)", () => {
  // A 4-beat clip with a note on beat 0 and beat 2.
  const clip = [note("a", 60, 0), note("b", 64, 2)];
  const CLIP = 4;

  it("plays a within-clip window once (a trim), no wrap", () => {
    // window [0,2): only the beat-0 note; the beat-2 note is outside.
    expect(tileClipNotes(clip, CLIP, 0, 2).map((n) => `${n.id}@${n.start}`)).toEqual(["a@0"]);
  });

  it("honours offset as a phase into the clip", () => {
    // offset 2, length 2: starts at the beat-2 note, plays it at arrangement 0.
    expect(tileClipNotes(clip, CLIP, 2, 2).map((n) => `${n.id}@${n.start}`)).toEqual(["b@0"]);
  });

  it("loops the clip when the window outruns it", () => {
    // length 8 = two clip lengths: each note fires twice, a clip-length apart.
    expect(tileClipNotes(clip, CLIP, 0, 8).map((n) => `${n.id}@${n.start}`)).toEqual(["a@0", "a@4", "b@2", "b@6"]);
  });

  it("ignores notes outside the clip body and a non-positive clip length", () => {
    expect(tileClipNotes([note("x", 60, 5)], CLIP, 0, 4)).toEqual([]);
    expect(tileClipNotes(clip, 0, 0, 4)).toEqual([]);
  });
});

describe("beatsToSeconds", () => {
  it("converts at tempo", () => {
    expect(beatsToSeconds(1, 120)).toBeCloseTo(0.5);
    expect(beatsToSeconds(4, 120)).toBeCloseTo(2);
    expect(beatsToSeconds(1, 60)).toBeCloseTo(1);
  });
});

describe("notesStartingInBeatRange", () => {
  const notes = [note("a", 60, 0), note("b", 64, 2), note("c", 67, 3.5)];
  const LOOP = 4;

  it("selects notes whose onset falls in [from, to)", () => {
    const hits = notesStartingInBeatRange(notes, 0, 3, LOOP);
    expect(hits.map((h) => h.note.id)).toEqual(["a", "b"]);
    expect(hits.map((h) => h.atBeat)).toEqual([0, 2]);
  });

  it("is half-open: includes from, excludes to", () => {
    expect(notesStartingInBeatRange(notes, 2, 3.5, LOOP).map((h) => h.note.id)).toEqual(["b"]);
  });

  it("wraps around the loop and reports continuous beats", () => {
    // window spanning the loop boundary: 3.4 .. 4.5 should catch c@3.5 then a@4.0
    const hits = notesStartingInBeatRange(notes, 3.4, 4.5, LOOP);
    expect(hits.map((h) => h.note.id)).toEqual(["c", "a"]);
    expect(hits.map((h) => h.atBeat)).toEqual([3.5, 4]);
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(notesStartingInBeatRange(notes, 2, 2, LOOP)).toEqual([]);
    expect(notesStartingInBeatRange(notes, 3, 1, LOOP)).toEqual([]);
  });
});

describe("loop region (loopStart)", () => {
  // Region [2, 6): loopLen 4. Only notes with start in [2,6) play; their onset is
  // relative to loopStart, so continuous beat 0 corresponds to beat 2.
  const notes = [note("a", 60, 0), note("b", 64, 2), note("c", 67, 4)];
  const LOOP_LEN = 4;
  const LOOP_START = 2;

  it("plays only notes inside the region, offset by loopStart", () => {
    const hits = notesStartingInBeatRange(notes, 0, 4, LOOP_LEN, LOOP_START);
    // a@0 is before the region (dropped); b@2 -> cont 0; c@4 -> cont 2.
    expect(hits.map((h) => h.note.id)).toEqual(["b", "c"]);
    expect(hits.map((h) => h.atBeat)).toEqual([0, 2]);
  });

  it("wraps within the region every loopLen beats", () => {
    // continuous [3.5, 4.5): next cycle's b@2 lands at cont 4.
    const hits = notesStartingInBeatRange(notes, 3.5, 4.5, LOOP_LEN, LOOP_START);
    expect(hits.map((h) => h.note.id)).toEqual(["b"]);
    expect(hits.map((h) => h.atBeat)).toEqual([4]);
  });

  it("onsetsInBeatRange honours the region too", () => {
    expect(onsetsInBeatRange(1, 0, 4, LOOP_LEN, LOOP_START)).toEqual([]); // before region
    expect(onsetsInBeatRange(3, 0, 4, LOOP_LEN, LOOP_START)).toEqual([1]); // 3 -> cont 1
  });
});
