import { describe, it, expect, beforeEach } from "vitest";
import { GraphMidiDevice, type NoteTarget } from "../src/audio/midi/device/GraphMidiDevice";
import { octavator } from "../src/audio/midi/device/devices/octavator";
import { octavatorSchema } from "../src/audio/midi/device/catalog";
import { ParamStore } from "../src/audio/params/store";

/** A downstream target that records every forwarded call. */
function fakeTarget() {
  const on: Array<[number, number | undefined]> = [];
  const off: number[] = [];
  const played: Array<[number, number]> = [];
  let allOff = 0;
  const target: NoteTarget = {
    noteOn: (midi, velocity) => void on.push([midi, velocity]),
    noteOff: (midi) => void off.push(midi),
    playNote: (midi, _dur, velocity) => void played.push([midi, velocity ?? 1]),
    allNotesOff: () => void (allOff += 1),
  };
  return { target, on, off, played, allOff: () => allOff };
}

describe("GraphMidiDevice (octavator)", () => {
  let store: ParamStore;
  let downstream: ReturnType<typeof fakeTarget>;
  let device: GraphMidiDevice;

  beforeEach(() => {
    store = new ParamStore(octavatorSchema);
    downstream = fakeTarget();
    device = new GraphMidiDevice(octavator, store, downstream.target, () => 0.5);
  });

  it("fans a noteOn out to the dry note + the octave up, and noteOff releases both", () => {
    device.noteOn(60, 1);
    expect(downstream.on).toEqual([
      [60, 1],
      [72, 0.7],
    ]);
    device.noteOff(60);
    expect(downstream.off).toEqual([60, 72]);
  });

  it("releases exactly the emitted notes even if params change between on and off", () => {
    device.noteOn(60, 1);
    store.set("octaveUp", false); // would change the transform for a NEW note
    device.noteOff(60);
    expect(downstream.off).toEqual([60, 72]); // still releases what it started
  });

  it("fans playNote out (stateless, no release tracking)", () => {
    device.playNote(60, 1, 1);
    expect(downstream.played).toEqual([
      [60, 1],
      [72, 0.7],
    ]);
  });

  it("passes through untouched when bypassed", () => {
    device.bypassed = true;
    device.noteOn(60, 1);
    device.noteOff(60);
    expect(downstream.on).toEqual([[60, 1]]);
    expect(downstream.off).toEqual([60]);
  });

  it("re-pressing a held note releases the old copies first", () => {
    device.noteOn(60, 1);
    device.noteOn(60, 1);
    expect(downstream.off).toEqual([60, 72]); // old copies released on the second press
    expect(downstream.on).toHaveLength(4); // two copies per press
  });

  it("allNotesOff clears held state and forwards", () => {
    device.noteOn(60, 1);
    device.allNotesOff();
    expect(downstream.allOff()).toBe(1);
    // After a global reset, a stale noteOff forwards raw (no emitted record left).
    downstream.off.length = 0;
    device.noteOff(60);
    expect(downstream.off).toEqual([60]);
  });
});
