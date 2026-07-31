import { describe, it, expect, afterEach } from "vitest";
import { EuclidStrategy } from "../src/audio/midi/device/devices/euclid/euclidStrategy";
import { GraphMidiDevice } from "../src/audio/midi/device/GraphMidiDevice";
import { euclidean } from "../src/audio/midi/device/devices/euclidean";
import { euclideanSchema } from "../src/audio/midi/device/catalog";
import type { MidiTransform } from "../src/audio/midi/device/transform";
import type { TransportClock } from "../src/audio/midi/device/clock";
import type { NoteTarget } from "../src/audio/midi/device/GraphMidiDevice";
import { ParamStore } from "../src/audio/params/store";

const euclidTransform = euclidean.transform as Extract<MidiTransform, { kind: "euclid" }>;

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

const strategies: EuclidStrategy[] = [];
function makeEuclid(clock: TransportClock, params: Record<string, string | number> = {}) {
  const store = new ParamStore(euclideanSchema);
  store.set("rate", "1/4"); // 1 beat = 0.5 s steps, for round numbers
  for (const [id, value] of Object.entries(params)) store.set(id, value);
  const next = fakeNext();
  const strategy = new EuclidStrategy(euclidTransform, { store, clock, next: () => next.target });
  strategies.push(strategy);
  return { strategy, next, store };
}

afterEach(() => {
  for (const strategy of strategies.splice(0)) strategy.dispose(); // clear any lookahead timers
});

describe("EuclidStrategy (euclid)", () => {
  it("plays the held note only on the pattern's onsets", () => {
    // E(3,8) = x..x..x. over 8 steps of 0.5 s = onsets at 0, 1.5, 3.0
    const { strategy, next } = makeEuclid(makeClock(), { steps: 8, pulses: 3 });
    strategy.playNote(60, 4, 1, 0);
    strategy.scheduleWindow(0, 4);
    expect(next.played.map((hit) => hit.when)).toEqual([0, 1.5, 3]);
    expect(next.played.every((hit) => hit.midi === 60)).toBe(true);
  });

  it("repeats the cycle past the pattern length", () => {
    // E(2,4) = x.x. -> onsets every 2 steps (1 s), so the second cycle continues the grid
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 2 });
    strategy.playNote(60, 8, 1, 0);
    strategy.scheduleWindow(0, 4);
    expect(next.played.map((hit) => hit.when)).toEqual([0, 1, 2, 3]);
  });

  it("rotate turns the pattern", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 8, pulses: 3, rotate: 1 });
    strategy.playNote(60, 4, 1, 0);
    strategy.scheduleWindow(0, 4);
    // E(3,8) rotated by 1 = ..x..x.x -> onsets at steps 2, 5, 7 = 1.0, 2.5, 3.5
    expect(next.played.map((hit) => hit.when)).toEqual([1, 2.5, 3.5]);
  });

  it("pulses = 0 is silence; pulses = steps hits every step", () => {
    const silent = makeEuclid(makeClock(), { steps: 4, pulses: 0 });
    silent.strategy.playNote(60, 4, 1, 0);
    silent.strategy.scheduleWindow(0, 2);
    expect(silent.next.played).toHaveLength(0);

    const solid = makeEuclid(makeClock(), { steps: 4, pulses: 4 });
    solid.strategy.playNote(60, 4, 1, 0);
    solid.strategy.scheduleWindow(0, 2);
    expect(solid.next.played.map((hit) => hit.when)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("plays the whole held chord on an onset by default (voicing = chord)", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 1 });
    for (const pitch of [60, 64, 67]) strategy.playNote(pitch, 4, 1, 0);
    strategy.scheduleWindow(0, 2);
    expect(next.played.map((hit) => hit.midi)).toEqual([60, 64, 67]); // one onset, three notes
    expect(next.played.every((hit) => hit.when === 0)).toBe(true);
  });

  it("voicing walks the chord per hit, not per step", () => {
    // E(2,4) = x.x. -> hits at steps 0 and 2; "up" should advance 60 -> 64, skipping rests
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 2, voicing: "up" });
    for (const pitch of [60, 64, 67]) strategy.playNote(pitch, 8, 1, 0);
    strategy.scheduleWindow(0, 4);
    expect(next.played.map((hit) => hit.midi)).toEqual([60, 64, 67, 60]);
  });

  it("repeats ratchets a single onset into evenly spaced retriggers", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 1, repeats: 3 });
    strategy.playNote(60, 4, 1, 0);
    strategy.scheduleWindow(0, 2);
    // one 0.5 s step split into 3: onsets at 0, 1/6, 2/6, each a third as long
    expect(next.played).toHaveLength(3);
    next.played.forEach((hit, index) => expect(hit.when).toBeCloseTo((index * 0.5) / 3));
    expect(next.played.every((hit) => Math.abs(hit.dur - 0.5 / 3 / 2) < 1e-9)).toBe(true); // gate 0.5
  });

  it("gate sets the hit length", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 4, gate: 0.25 });
    strategy.playNote(60, 4, 1, 0);
    strategy.scheduleWindow(0, 1);
    expect(next.played.every((hit) => hit.dur === 0.125)).toBe(true); // 0.25 x 0.5 s
  });

  it("accent keeps the cycle's first hit loud and ducks the rest", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 2, accent: 0.5 });
    strategy.playNote(60, 8, 1, 0);
    strategy.scheduleWindow(0, 2);
    expect(next.played.map((hit) => hit.vel)).toEqual([1, 0.5]);
  });

  it("accents the first real onset even when rotation moves it off step 0", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 2, rotate: 1, accent: 1 });
    strategy.playNote(60, 8, 1, 0);
    strategy.scheduleWindow(0, 2);
    // rotated E(2,4) = .x.x -> hits at steps 1 and 3; the first of them carries the accent
    expect(next.played.map((hit) => hit.when)).toEqual([0.5, 1.5]);
    expect(next.played.map((hit) => hit.vel)).toEqual([1, 0]);
  });

  it("free-runs from the first note when the transport is stopped", () => {
    const { strategy, next } = makeEuclid(makeClock({ playing: false }), { steps: 4, pulses: 2 });
    strategy.noteOn(60, 1, 0);
    strategy.scheduleWindow(0, 4);
    expect(next.played.map((hit) => hit.when)).toEqual([0, 1, 2, 3]);
  });

  it("allNotesOff clears the held chord (no more hits)", () => {
    const { strategy, next } = makeEuclid(makeClock(), { steps: 4, pulses: 4 });
    strategy.noteOn(60, 1, 0);
    strategy.allNotesOff();
    strategy.scheduleWindow(0, 2);
    expect(next.played).toHaveLength(0);
  });

  it("re-reads params mid-phrase, so pulses can be automated", () => {
    const { strategy, next, store } = makeEuclid(makeClock(), { steps: 4, pulses: 1 });
    strategy.playNote(60, 8, 1, 0);
    strategy.scheduleWindow(0, 2); // one hit at 0
    store.set("pulses", 4);
    strategy.scheduleWindow(2, 4); // now every step
    expect(next.played.map((hit) => hit.when)).toEqual([0, 2, 2.5, 3, 3.5]);
  });
});

describe("GraphMidiDevice with the euclidean def", () => {
  it("passes notes straight through when bypassed", () => {
    const store = new ParamStore(euclideanSchema);
    const next = fakeNext();
    const device = new GraphMidiDevice(euclidean, store, next.target, makeClock());
    device.bypassed = true;
    device.playNote(60, 1, 1, 0);
    expect(next.played).toEqual([{ midi: 60, dur: 1, vel: 1, when: 0 }]);
    device.dispose();
  });
});
