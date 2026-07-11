/**
 * The runtime interpreter for a declarative MIDI device (transform.ts). It is a
 * decorator on the note path: it implements the note-driving subset of an instrument
 * (`NoteTarget`), wraps a downstream target, and forwards each event through its
 * transform, terminating in the instrument. A device touches no Web Audio - it only
 * forwards note calls - so it (like the transform) is DOM-free.
 *
 * State: a `noteOn` records the exact notes it emitted (keyed by the incoming note)
 * so the matching `noteOff` releases those same notes, even if a param changed the
 * transform in between. `playNote` is fire-and-forget (the scheduler owns the
 * release), so it needs no state. Params are read lazily at each event (transforms
 * evaluate at discrete events, not on a continuous signal), so there is no binding.
 */
import type { ParamStore } from "../../params/store";
import { applyTransform, type EmittedNote, type MidiDeviceDef, type TransformContext } from "./transform";

/** The note-driving subset of an instrument. An `Instrument` structurally satisfies it. */
export interface NoteTarget {
  noteOn(midi: number, velocity?: number, when?: number): void;
  noteOff(midi: number, when?: number): void;
  playNote(midi: number, durationSec: number, velocity?: number, when?: number): void;
  allNotesOff(): void;
}

/** Shift an absolute time by a beat offset. Live events (no `when`) or zero offsets pass through. */
const offsetWhen = (when: number | undefined, beats: number, secondsPerBeat: number): number | undefined =>
  beats === 0 || when === undefined ? when : when + beats * secondsPerBeat;

export class GraphMidiDevice implements NoteTarget {
  readonly type: string;
  bypassed = false;

  private readonly def: MidiDeviceDef;
  private readonly store: ParamStore;
  private next: NoteTarget;
  private readonly secondsPerBeat: () => number;
  /** Incoming note -> the notes we emitted for it, so noteOff releases exactly those. */
  private readonly emitted = new Map<number, EmittedNote[]>();

  constructor(def: MidiDeviceDef, store: ParamStore, next: NoteTarget, secondsPerBeat: () => number) {
    this.def = def;
    this.type = def.type;
    this.store = store;
    this.next = next;
    this.secondsPerBeat = secondsPerBeat;
  }

  /** Relink to the next target in the chain (the engine calls this on reconcile). */
  setNext(next: NoteTarget): void {
    this.next = next;
  }

  private context(): TransformContext {
    return { readParam: (id) => this.store.get(id) };
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    if (this.bypassed) {
      this.next.noteOn(midi, velocity, when);
      return;
    }
    // Re-pressing a still-held note: release the old copies first, then start fresh.
    if (this.emitted.has(midi)) this.releaseEmitted(midi, when);
    const notes = applyTransform(this.def.transform, midi, velocity, this.context());
    const secondsPerBeat = this.secondsPerBeat();
    for (const note of notes) this.next.noteOn(note.midi, note.velocity, offsetWhen(when, note.beats, secondsPerBeat));
    this.emitted.set(midi, notes);
  }

  noteOff(midi: number, when?: number): void {
    // A note played through while bypassed has no emitted record: release it straight.
    if (!this.emitted.has(midi)) {
      this.next.noteOff(midi, when);
      return;
    }
    this.releaseEmitted(midi, when);
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    if (this.bypassed) {
      this.next.playNote(midi, durationSec, velocity, when);
      return;
    }
    const notes = applyTransform(this.def.transform, midi, velocity, this.context());
    const secondsPerBeat = this.secondsPerBeat();
    for (const note of notes)
      this.next.playNote(note.midi, durationSec, note.velocity, offsetWhen(when, note.beats, secondsPerBeat));
  }

  allNotesOff(): void {
    this.emitted.clear();
    this.next.allNotesOff();
  }

  /** Release the device's held state into the downstream (avoids stuck notes on removal). */
  dispose(): void {
    for (const midi of [...this.emitted.keys()]) this.releaseEmitted(midi);
    this.emitted.clear();
  }

  private releaseEmitted(midi: number, when?: number): void {
    const notes = this.emitted.get(midi);
    if (!notes) return;
    this.emitted.delete(midi);
    const secondsPerBeat = this.secondsPerBeat();
    for (const note of notes) this.next.noteOff(note.midi, offsetWhen(when, note.beats, secondsPerBeat));
  }
}
