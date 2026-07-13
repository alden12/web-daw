/**
 * The silent instrument: the audio half of the "none" sentinel (an empty track with
 * no instrument chosen yet). It satisfies the Instrument interface but produces no
 * sound - every note method is a no-op - so an empty track can carry clips and sit in
 * the mix (its output/effect chain wire up normally) until a real instrument is
 * assigned via `setInstrument`, at which point the engine swaps this node out.
 */
import type { Instrument } from "./types";

export class SilentInstrument implements Instrument {
  readonly output: GainNode;

  constructor(ctx: AudioContext) {
    this.output = ctx.createGain();
  }

  noteOn(): void {}
  noteOff(): void {}
  playNote(): void {}
  allNotesOff(): void {}
  dispose(): void {
    this.output.disconnect();
  }
}
