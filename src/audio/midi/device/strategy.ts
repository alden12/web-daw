/**
 * A MIDI device's runtime strategy: the behavior behind a transform kind. GraphMidiDevice
 * (the single interpreter) picks one from `transform.kind` and delegates the note-driving
 * calls to it, while the device itself owns bypass + the downstream link. `tap` is the
 * stateless fan-out here; `arpeggiate` (the stateful generator) lives in devices/arp/.
 */
import type { ParamStore } from "../../params/store";
import type { NoteTarget } from "./GraphMidiDevice";
import type { TransportClock } from "./clock";
import { applyTransform, type EmittedNote, type MidiTransform } from "./transform";

/** What a strategy needs from its host device: params, the transport clock, and the live next target. */
export interface StrategyContext {
  store: ParamStore;
  clock: TransportClock;
  /** The current downstream target (a getter so the device can relink mid-life via setNext). */
  next: () => NoteTarget;
}

export interface MidiStrategy {
  noteOn(midi: number, velocity: number | undefined, when: number | undefined): void;
  noteOff(midi: number, when: number | undefined): void;
  playNote(midi: number, durationSec: number, velocity: number | undefined, when: number | undefined): void;
  allNotesOff(): void;
  dispose(): void;
}

/** Shift an absolute time by a beat offset; live events (no `when`) or zero offsets pass through. */
const offsetWhen = (when: number | undefined, beats: number, secondsPerBeat: number): number | undefined =>
  beats === 0 || when === undefined ? when : when + beats * secondsPerBeat;

/**
 * The `tap` (fan-out) strategy: each incoming note emits N param-driven copies (pitch/velocity/
 * beat offsets). A `noteOn` records exactly what it emitted so the matching `noteOff` releases
 * those same notes even if a param changed the transform in between; `playNote` is fire-and-forget.
 */
export class TapStrategy implements MidiStrategy {
  private readonly transform: Extract<MidiTransform, { kind: "tap" }>;
  private readonly ctx: StrategyContext;
  private readonly emitted = new Map<number, EmittedNote[]>();

  constructor(transform: Extract<MidiTransform, { kind: "tap" }>, ctx: StrategyContext) {
    this.transform = transform;
    this.ctx = ctx;
  }

  private context() {
    return { readParam: (id: string) => this.ctx.store.get(id) };
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    if (this.emitted.has(midi)) this.releaseEmitted(midi, when);
    const notes = applyTransform(this.transform, midi, velocity, this.context());
    const secondsPerBeat = this.ctx.clock.secondsPerBeat;
    const next = this.ctx.next();
    for (const note of notes) next.noteOn(note.midi, note.velocity, offsetWhen(when, note.beats, secondsPerBeat));
    this.emitted.set(midi, notes);
  }

  noteOff(midi: number, when?: number): void {
    if (!this.emitted.has(midi)) {
      this.ctx.next().noteOff(midi, when);
      return;
    }
    this.releaseEmitted(midi, when);
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    const notes = applyTransform(this.transform, midi, velocity, this.context());
    const secondsPerBeat = this.ctx.clock.secondsPerBeat;
    const next = this.ctx.next();
    for (const note of notes)
      next.playNote(note.midi, durationSec, note.velocity, offsetWhen(when, note.beats, secondsPerBeat));
  }

  allNotesOff(): void {
    this.emitted.clear();
  }

  dispose(): void {
    for (const midi of [...this.emitted.keys()]) this.releaseEmitted(midi);
    this.emitted.clear();
  }

  private releaseEmitted(midi: number, when?: number): void {
    const notes = this.emitted.get(midi);
    if (!notes) return;
    this.emitted.delete(midi);
    const secondsPerBeat = this.ctx.clock.secondsPerBeat;
    const next = this.ctx.next();
    for (const note of notes) next.noteOff(note.midi, offsetWhen(when, note.beats, secondsPerBeat));
  }
}
