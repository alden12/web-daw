import { describe, it, expect, beforeEach } from "vitest";
import {
  LiveNotes,
  type EngineLike,
  type InstrumentTarget,
  type ProjectLike,
  type RecorderLike,
} from "../src/audio/live/liveNotes";

type Call = { note: number; velocity?: number };

function fakeInstrument() {
  const on: Call[] = [];
  const off: number[] = [];
  const target: InstrumentTarget = {
    noteOn: (note, velocity) => on.push({ note, velocity }),
    noteOff: (note) => off.push(note),
  };
  return { target, on, off };
}

function fakeRecorder() {
  const on: Call[] = [];
  const off: number[] = [];
  const recorder: RecorderLike = {
    noteOn: (note, velocity) => on.push({ note, velocity }),
    noteOff: (note) => off.push(note),
  };
  return { recorder, on, off };
}

describe("LiveNotes", () => {
  let inst: ReturnType<typeof fakeInstrument>;
  let rec: ReturnType<typeof fakeRecorder>;
  let project: ProjectLike & { selectedId: string | null };
  let engine: EngineLike;
  let live: LiveNotes;

  beforeEach(() => {
    inst = fakeInstrument();
    rec = fakeRecorder();
    project = { selectedId: "track-1" };
    engine = { getNoteTarget: (id) => (id === "track-1" ? inst.target : undefined) };
    live = new LiveNotes(engine, project, rec.recorder);
  });

  it("routes note-on/off to the selected instrument and the recorder, with velocity", () => {
    live.noteOn(60, 0.5);
    live.noteOff(60);
    expect(inst.on).toEqual([{ note: 60, velocity: 0.5 }]);
    expect(inst.off).toEqual([60]);
    expect(rec.on).toEqual([{ note: 60, velocity: 0.5 }]);
    expect(rec.off).toEqual([60]);
  });

  it("does nothing when no track is selected", () => {
    project.selectedId = null;
    live.noteOn(60, 0.8);
    expect(inst.on).toEqual([]);
    expect(rec.on).toEqual([]);
  });

  it("releases a held note on the instrument it started on, even after the selection changes", () => {
    live.noteOn(60, 0.8);
    project.selectedId = "track-2"; // change selection mid-press
    live.noteOff(60);
    // The note-off still routes to track-1's instrument (the one it started on).
    expect(inst.off).toEqual([60]);
  });

  it("holds note-offs while the sustain pedal is down and flushes them when it lifts", () => {
    live.setSustain(true);
    live.noteOn(60, 0.8);
    live.noteOn(64, 0.8);
    live.noteOff(60);
    live.noteOff(64);
    // Both keys released, but the pedal holds them: no note-off yet.
    expect(inst.off).toEqual([]);
    expect(rec.off).toEqual([]);
    live.setSustain(false);
    // Lifting the pedal releases everything it was holding.
    expect(inst.off.sort()).toEqual([60, 64]);
    expect(rec.off.sort()).toEqual([60, 64]);
  });

  it("keeps a note held after key-release while the pedal is still down, then releases with the key up", () => {
    live.noteOn(60, 0.8);
    live.setSustain(true);
    live.noteOff(60); // key up under pedal -> held
    expect(inst.off).toEqual([]);
    live.setSustain(false);
    expect(inst.off).toEqual([60]);
  });

  it("re-articulates a pedal-sustained note: the old note closes before the new press", () => {
    live.setSustain(true);
    live.noteOn(60, 0.8);
    live.noteOff(60); // sustained
    live.noteOn(60, 0.9); // re-press same note
    // The first note was closed (off) before the second on, so the recording keeps both.
    expect(inst.off).toEqual([60]);
    expect(inst.on).toEqual([
      { note: 60, velocity: 0.8 },
      { note: 60, velocity: 0.9 },
    ]);
    expect(rec.on.length).toBe(2);
    expect(rec.off.length).toBe(1);
  });

  it("releaseAll releases every held note and clears sustain", () => {
    live.setSustain(true);
    live.noteOn(60, 0.8);
    live.noteOn(64, 0.8);
    live.releaseAll();
    expect(inst.off.sort()).toEqual([60, 64]);
    // Sustain is cleared, so the next note-off releases immediately.
    live.noteOn(67, 0.8);
    live.noteOff(67);
    expect(inst.off.sort()).toEqual([60, 64, 67]);
  });
});
