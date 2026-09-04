import { describe, expect, it } from "vitest";
import { splitNoteAt } from "../src/ui/roll/noteEdits";
import type { NoteEvent } from "../src/audio/sequencer/types";

const NOTE: NoteEvent = { id: "original", pitch: 60, start: 2, length: 1, velocity: 0.8 };

describe("splitNoteAt", () => {
  it("cuts the note in two at the point, keeping the original's id on the head", () => {
    // The head keeping the id is what lets both halves go out as one `addNotes`, which is
    // insert-or-replace by id - so the split is one undo step rather than an edit and an add.
    const parts = splitNoteAt(NOTE, 2.25, "tail")!;
    expect(parts).toEqual([
      { id: "original", pitch: 60, start: 2, length: 0.25, velocity: 0.8 },
      { id: "tail", pitch: 60, start: 2.25, length: 0.75, velocity: 0.8 },
    ]);
  });

  it("leaves the note's total length alone", () => {
    [2.1, 2.5, 2.9].forEach((at) => {
      const [head, tail] = splitNoteAt(NOTE, at, "tail")!;
      expect(head.length + tail.length).toBeCloseTo(NOTE.length);
      expect(head.start).toBe(NOTE.start);
      expect(tail.start + tail.length).toBeCloseTo(NOTE.start + NOTE.length);
    });
  });

  it("refuses a point that is not strictly inside, rather than making a zero-length note", () => {
    // The ends are the cases that matter: the playhead parked exactly on a note's start is the
    // ordinary state of a stopped transport, and splitting there would produce nothing plus a
    // copy of the note.
    [NOTE.start, NOTE.start + NOTE.length, 0, 99].forEach((at) => {
      expect(splitNoteAt(NOTE, at, "tail")).toBeNull();
    });
  });

  it("carries pitch and velocity into both halves", () => {
    const quiet: NoteEvent = { ...NOTE, velocity: 0.2, pitch: 48 };
    splitNoteAt(quiet, 2.5, "tail")!.forEach((part) => {
      expect(part.pitch).toBe(48);
      expect(part.velocity).toBe(0.2);
    });
  });
});
