import { describe, it, expect, afterEach } from "vitest";
import { ArpStrategy } from "../src/audio/midi/device/devices/arp/arpStrategy";
import { GraphMidiDevice } from "../src/audio/midi/device/GraphMidiDevice";
import { arpeggiator } from "../src/audio/midi/device/devices/arpeggiator";
import { arpeggiatorSchema } from "../src/audio/midi/device/catalog";
import type { MidiTransform } from "../src/audio/midi/device/transform";
import type { TransportClock } from "../src/audio/midi/device/clock";
import type { NoteTarget } from "../src/audio/midi/device/GraphMidiDevice";
import { ParamStore } from "../src/audio/params/store";

const arpTransform = arpeggiator.transform as Extract<MidiTransform, { kind: "arpeggiate" }>;

/** A downstream target that records forwarded playNote calls. */
function fakeNext() {
  const played: { midi: number; dur: number; vel: number; when: number | undefined }[] = [];
  const target: NoteTarget = {
    noteOn: () => {},
    noteOff: () => {},
    playNote: (midi, dur, vel, when) => void played.push({ midi, dur, vel: vel ?? 1, when }),
    allNotesOff: () => {},
  };
  return { target, played };
}

// A steady 120 BPM clock: 0.5 s/beat, so continuous beat = time x 2. Playing by default.
const makeClock = (over: Partial<TransportClock> = {}): TransportClock => ({
  playing: true,
  currentTime: 0,
  secondsPerBeat: 0.5,
  continuousBeatAtTime: (time) => time * 2,
  ...over,
});

const strategies: ArpStrategy[] = [];
function makeArp(clock: TransportClock, params: Record<string, string | number> = {}) {
  const store = new ParamStore(arpeggiatorSchema);
  store.set("rate", "1/4"); // 1 beat = 0.5 s steps, for round numbers
  for (const [id, value] of Object.entries(params)) store.set(id, value);
  const next = fakeNext();
  const strategy = new ArpStrategy(arpTransform, { store, clock, next: () => next.target });
  strategies.push(strategy);
  return { strategy, next, store };
}

afterEach(() => {
  for (const strategy of strategies.splice(0)) strategy.dispose(); // clear any lookahead timers
});

describe("ArpStrategy (arpeggiate)", () => {
  it("steps a held chord up on the transport grid (playback spans)", () => {
    const { strategy, next } = makeArp(makeClock());
    for (const pitch of [60, 64, 67]) strategy.playNote(pitch, 4, 1, 0); // chord held [0,4]
    strategy.scheduleWindow(0, 2);
    expect(next.played.map((step) => step.midi)).toEqual([60, 64, 67, 60]);
    expect(next.played.map((step) => step.when)).toEqual([0, 0.5, 1, 1.5]);
    expect(next.played.every((step) => step.dur === 0.25)).toBe(true); // gate 0.5 x 0.5 s step
  });

  it("live noteOn/noteOff produces the same steps as playback spans", () => {
    const { strategy, next } = makeArp(makeClock());
    for (const pitch of [60, 64, 67]) strategy.noteOn(pitch, 1, 0); // held open-ended
    strategy.scheduleWindow(0, 2);
    expect(next.played.map((step) => step.midi)).toEqual([60, 64, 67, 60]);
    expect(next.played.map((step) => step.when)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("gate sets the step note length", () => {
    const { strategy, next } = makeArp(makeClock(), { gate: 0.25 });
    strategy.noteOn(60, 1, 0);
    strategy.scheduleWindow(0, 1);
    expect(next.played.every((step) => step.dur === 0.125)).toBe(true); // 0.25 x 0.5 s
  });

  it("only steps notes whose span covers the step time", () => {
    const { strategy, next } = makeArp(makeClock());
    strategy.playNote(60, 1, 1, 0); // held [0,1) only
    strategy.scheduleWindow(0, 2);
    // steps at 0 and 0.5 land inside the span; 1 and 1.5 are past its end
    expect(next.played.map((step) => step.when)).toEqual([0, 0.5]);
  });

  it("free-runs from the first note when the transport is stopped", () => {
    const { strategy, next } = makeArp(makeClock({ playing: false }));
    strategy.noteOn(60, 1, 0);
    strategy.scheduleWindow(0, 2);
    expect(next.played.map((step) => step.midi)).toEqual([60, 60, 60, 60]);
    expect(next.played.map((step) => step.when)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("allNotesOff clears the held chord (no more steps)", () => {
    const { strategy, next } = makeArp(makeClock());
    strategy.noteOn(60, 1, 0);
    strategy.allNotesOff();
    strategy.scheduleWindow(0, 2);
    expect(next.played).toHaveLength(0);
  });
});

describe("GraphMidiDevice with the arp def", () => {
  it("passes notes straight through when bypassed", () => {
    const store = new ParamStore(arpeggiatorSchema);
    const next = fakeNext();
    const device = new GraphMidiDevice(arpeggiator, store, next.target, makeClock());
    device.bypassed = true;
    device.playNote(60, 1, 1, 0);
    expect(next.played).toEqual([{ midi: 60, dur: 1, vel: 1, when: 0 }]);
    device.dispose();
  });
});
