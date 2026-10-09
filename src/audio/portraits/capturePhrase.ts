/**
 * What a MIDI device plays from a short input, as notes (COMM-1.9.2): the phrase its Explore
 * portrait draws. DOM-free and synchronous - the device runs against a fake clock and its steps are
 * scheduled straight through (`GraphMidiDevice.scheduleWindow`), so nothing waits in real time.
 *
 * **The input depends on the device.** A generator (arpeggiator, Euclidean) is fed a held chord,
 * which it turns into rhythm. A pass-through (the octavator) does nothing a held chord can show -
 * every copy would last the whole phrase and draw as a row of full-width bars - so it is fed a
 * short melody instead, which it then plays with its copies.
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
/** Up the triad and back: four notes, for a device with no timing of its own to show. */
const MELODY = [60, 64, 67, 64];
const SECONDS_PER_BEAT = 0.5; // 120 BPM

export function capturePhrase(
  type: string,
  // Half a bar: at card size a whole bar of eighths is a row of slivers, and half shows the
  // pattern with notes wide enough to read.
  { bars = 0.5, params = {} }: { bars?: number; params?: Record<string, ParamValue> } = {},
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
  if (device.generates) {
    CHORD.forEach((pitch) => device.playNote(pitch, spanSec, 0.9, 0));
    device.scheduleWindow(0, spanSec);
  } else {
    const step = spanSec / MELODY.length;
    MELODY.forEach((pitch, index) => device.playNote(pitch, step * 0.85, 0.9, index * step));
  }
  device.dispose();
  return { notes, spanSec };
}
