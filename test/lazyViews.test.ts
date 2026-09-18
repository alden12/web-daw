/**
 * The cached views are built when read, not when written (DAW-38).
 *
 * `ProjectStore` and `ClipStore` both hand out a cached object so React's `useSyncExternalStore`
 * sees a stable reference. Both used to build that object inside `emit()`, on every mutation, and
 * `buildStructure` walks the whole project - so replaying a log cost O(edits x project) and a
 * hundred thousand edits took twelve seconds instead of a tenth of one. These pin the shape of the
 * fix rather than the timings, which vary by machine: one build per read, not one per write.
 */
import { describe, expect, it, vi } from "vitest";
import { ProjectStore, type InstrumentTrack } from "../src/audio/project/projectStore";
import { replayEntries } from "../src/audio/commands/replay";
import { ClipStore } from "../src/audio/sequencer/clipStore";
import type { EditCommand, EditEntry } from "../src/audio/commands/types";

const counters = vi.hoisted(() => ({ structures: 0 }));

vi.mock("../src/audio/project/projectStructure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/audio/project/projectStructure")>();
  return {
    ...actual,
    buildStructure: (...args: Parameters<typeof actual.buildStructure>) => {
      counters.structures += 1;
      return actual.buildStructure(...args);
    },
  };
});

const entry = (index: number, command: EditCommand): EditEntry => ({
  seq: index,
  id: `e-${index}`,
  command,
  author: "you",
  time: 0,
  kind: "edit",
});

/** A track with `notes` notes piled onto its clip, which is the shape a real project grows into. */
const noteLog = (notes: number): EditEntry[] => [
  entry(0, { type: "createTrack", instrumentType: "subtractive", id: "t-1", name: "Track" }),
  ...Array.from({ length: notes }, (_, index) =>
    entry(index + 1, {
      type: "addNote",
      trackId: "t-1",
      clipId: "c-t-1",
      note: { id: `n-${index}`, start: (index % 16) * 0.25, length: 0.25, pitch: 48 + (index % 24), velocity: 0.8 },
    }),
  ),
];

describe("the cached views a rebuild pays for", () => {
  it("builds the project structure once for a whole replay, not once an edit", () => {
    const store = new ProjectStore(false);
    counters.structures = 0;

    replayEntries(store, noteLog(200));
    expect(counters.structures).toBe(0);

    expect(store.getStructure().tracks).toHaveLength(1);
    expect(counters.structures).toBe(1);
  });

  it("hands out the same structure until something changes it", () => {
    const store = new ProjectStore(false);
    replayEntries(store, noteLog(2));

    const structure = store.getStructure();
    expect(store.getStructure()).toBe(structure);

    replayEntries(store, [entry(99, { type: "setTempo", bpm: 140 })]);
    expect(store.getStructure()).not.toBe(structure);
    expect(store.getStructure().tempoBpm).toBe(140);
  });

  it("describes a clip by its length, without materializing its notes", () => {
    const store = new ProjectStore(false);
    replayEntries(store, noteLog(4));
    const track = store.getTracks()[0] as InstrumentTrack;
    const sorted = vi.spyOn(track.clips[0].store, "getClip");

    const [described] = (store.getStructure().tracks[0] as { clips: { lengthBeats: number }[] }).clips;

    expect(described.lengthBeats).toBe(track.clips[0].store.getLength());
    expect(sorted).not.toHaveBeenCalled();
  });

  it("sorts a clip's notes when they are read, and keeps that reference until the next edit", () => {
    const clip = new ClipStore();
    clip.addNote({ pitch: 64, start: 1 });
    clip.addNote({ pitch: 60, start: 0 });

    const view = clip.getClip();
    expect(view.notes.map((note) => note.pitch)).toEqual([60, 64]);
    expect(clip.getClip()).toBe(view);

    clip.addNote({ pitch: 67, start: 2 });
    expect(clip.getClip()).not.toBe(view);
    expect(clip.getClip().notes).toHaveLength(3);
  });
});
