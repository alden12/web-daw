/**
 * What a MIDI device plays from one held chord, as notes (COMM-1.9.2): the phrase its Explore
 * portrait draws. DOM-free and synchronous - the device runs against a fake clock and its steps are
 * scheduled straight through (`GraphMidiDevice.scheduleWindow`), so nothing waits in real time.
 */
import { createMidiDevice } from "../midi/device/registry";
import { midiDeviceCatalogEntry } from "../midi/device/catalog";
import type { NoteTarget } from "../midi/device/GraphMidiDevice";
import type { TransportClock } from "../midi/device/clock";
import { ParamStore } from "../params/store";
import type { ParamValue } from "../params/types";
import type { PhraseNote } from "./draw";

/** A C major triad on middle C (C4 = MIDI 60), held for the whole phrase. */
const CHORD = [60, 64, 67];
const SECONDS_PER_BEAT = 0.5; // 120 BPM

export function capturePhrase(
  type: string,
  { bars = 2, params = {} }: { bars?: number; params?: Record<string, ParamValue> } = {},
): { notes: PhraseNote[]; spanSec: number } {
  const spanSec = bars * 4 * SECONDS_PER_BEAT;
  const notes: PhraseNote[] = [];
  const recorder: NoteTarget = {
    noteOn: () => {},
    noteOff: () => {},
    playNote: (pitch, length, _velocity, when) => void notes.push({ pitch, start: when ?? 0, length }),
    allNotesOff: () => {},
  };
  const clock: TransportClock = {
    playing: true,
    currentTime: 0,
    secondsPerBeat: SECONDS_PER_BEAT,
    continuousBeatAtTime: (time) => time / SECONDS_PER_BEAT,
  };
  const store = new ParamStore(midiDeviceCatalogEntry(type).schema);
  Object.entries(params).forEach(([id, value]) => store.set(id, value));
  const device = createMidiDevice(type, store, recorder, clock);
  CHORD.forEach((pitch) => device.playNote(pitch, spanSec, 0.9, 0));
  device.scheduleWindow(0, spanSec);
  device.dispose();
  return { notes, spanSec };
}
