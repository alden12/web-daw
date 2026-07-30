/**
 * The single runtime interpreter for a declarative MIDI device (transform.ts). It is a
 * decorator on the note path: it implements the note-driving subset of an instrument
 * (`NoteTarget`), wraps a downstream target, and runs the device's transform, terminating
 * in the instrument. A device touches no Web Audio - it only forwards note calls - so it is
 * DOM-free.
 *
 * The def is data; the behavior is a strategy chosen from `transform.kind` (see strategy.ts):
 * `tap` is a stateless fan-out, `arpeggiate` and `euclid` are stateful clock-driven generators.
 * The device owns bypass + the downstream link and delegates the note calls to its strategy, so
 * the whole family stays one class over pure-data defs.
 */
import type { ParamStore } from "../../params/store";
import type { MidiDeviceDef, MidiTransform } from "./transform";
import type { TransportClock } from "./clock";
import { type MidiStrategy, type StrategyContext, TapStrategy } from "./strategy";
import { ArpStrategy } from "./devices/arp/arpStrategy";
import { EuclidStrategy } from "./devices/euclid/euclidStrategy";

/**
 * Transform kind -> the strategy that runs it: the one place kinds are dispatched. Typed off
 * the union, so adding a kind to MidiTransform without a strategy here is a compile error.
 */
const STRATEGIES: {
  [Kind in MidiTransform["kind"]]: (
    transform: Extract<MidiTransform, { kind: Kind }>,
    ctx: StrategyContext,
  ) => MidiStrategy;
} = {
  tap: (transform, ctx) => new TapStrategy(transform, ctx),
  arpeggiate: (transform, ctx) => new ArpStrategy(transform, ctx),
  euclid: (transform, ctx) => new EuclidStrategy(transform, ctx),
};

/** The lookup narrows per key at the definition site above; TS can't correlate the two sides
 *  of the index here, so this is the single cast that ties them together. */
const createStrategy = (transform: MidiTransform, ctx: StrategyContext): MidiStrategy =>
  (STRATEGIES[transform.kind] as (transform: MidiTransform, ctx: StrategyContext) => MidiStrategy)(transform, ctx);

/** The note-driving subset of an instrument. An `Instrument` structurally satisfies it. */
export interface NoteTarget {
  noteOn(midi: number, velocity?: number, when?: number): void;
  noteOff(midi: number, when?: number): void;
  playNote(midi: number, durationSec: number, velocity?: number, when?: number): void;
  allNotesOff(): void;
}

export class GraphMidiDevice implements NoteTarget {
  readonly type: string;
  bypassed = false;

  private next: NoteTarget;
  private readonly strategy: MidiStrategy;

  constructor(def: MidiDeviceDef, store: ParamStore, next: NoteTarget, clock: TransportClock) {
    this.type = def.type;
    this.next = next;
    const ctx: StrategyContext = { store, clock, next: () => this.next };
    this.strategy = createStrategy(def.transform, ctx);
  }

  /** Relink to the next target in the chain (the engine calls this on reconcile). */
  setNext(next: NoteTarget): void {
    this.next = next;
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    if (this.bypassed) this.next.noteOn(midi, velocity, when);
    else this.strategy.noteOn(midi, velocity, when);
  }

  noteOff(midi: number, when?: number): void {
    if (this.bypassed) this.next.noteOff(midi, when);
    else this.strategy.noteOff(midi, when);
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    if (this.bypassed) this.next.playNote(midi, durationSec, velocity, when);
    else this.strategy.playNote(midi, durationSec, velocity, when);
  }

  allNotesOff(): void {
    this.strategy.allNotesOff();
    this.next.allNotesOff();
  }

  /** Release held state into the downstream (avoids stuck notes on removal) and stop any timer. */
  dispose(): void {
    this.strategy.dispose();
  }
}
