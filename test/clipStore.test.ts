import { describe, expect, it, vi } from "vitest";
import { ClipStore } from "../src/audio/sequencer/clipStore";
import { GRID } from "../src/audio/sequencer/types";

describe("ClipStore", () => {
  it("starts empty with sensible defaults", () => {
    const clip = new ClipStore().getClip();
    expect(clip.notes).toEqual([]);
    expect(clip.lengthBeats).toBe(16);
  });

  it("keeps off-grid positions (no force-snap) and returns ids", () => {
    const store = new ClipStore();
    const id = store.addNote({ pitch: 60, start: 1.1, length: 0.9 });
    expect(typeof id).toBe("string");
    const [note] = store.getClip().notes;
    expect(note.pitch).toBe(60);
    expect(note.start).toBe(1.1); // preserved exactly - quantize is now explicit
    expect(note.length).toBe(0.9); // preserved exactly
    expect(note.velocity).toBe(0.8); // default
  });

  it("clamps pitch, velocity, and floors length to a 16th", () => {
    const store = new ClipStore();
    store.addNote({ pitch: 999, start: 0, velocity: 5, length: 0.01 });
    const [note] = store.getClip().notes;
    expect(note.pitch).toBe(127);
    expect(note.velocity).toBe(1);
    expect(note.length).toBe(GRID); // tiny length floored to the minimum
  });

  it("removes and clears notes", () => {
    const store = new ClipStore();
    const id = store.addNote({ pitch: 60, start: 0 });
    store.addNote({ pitch: 64, start: 1 });
    store.removeNote(id);
    expect(store.getClip().notes).toHaveLength(1);
    store.clear();
    expect(store.getClip().notes).toHaveLength(0);
  });

  it("putNote inserts/replaces by id (for sync from elsewhere)", () => {
    const store = new ClipStore();
    store.putNote({ id: "fixed", pitch: 60, start: 0, length: 1, velocity: 0.5 });
    store.putNote({ id: "fixed", pitch: 62, start: 2, length: 1, velocity: 0.5 });
    const notes = store.getClip().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].pitch).toBe(62);
  });

  it("round-trips snapshot and load", () => {
    const a = new ClipStore();
    a.addNote({ pitch: 67, start: 2, length: 2, velocity: 0.9 });
    const snap = a.snapshot();

    const b = new ClipStore();
    b.load(snap);
    expect(b.getClip().notes).toHaveLength(1);
    expect(b.getClip().notes[0].pitch).toBe(67);
  });

  it("returns a stable snapshot reference between mutations", () => {
    const store = new ClipStore();
    const a = store.getClip();
    expect(store.getClip()).toBe(a); // same ref, no mutation
    store.addNote({ pitch: 60, start: 0 });
    expect(store.getClip()).not.toBe(a); // new ref after mutation
  });

  it("notifies subscribers on change", () => {
    const store = new ClipStore();
    const fn = vi.fn();
    store.subscribe(fn);
    store.addNote({ pitch: 60, start: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
