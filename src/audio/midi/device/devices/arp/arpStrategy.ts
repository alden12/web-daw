/**
 * The `arpeggiate` strategy: at each step of the tempo grid, play the next pitch of the held
 * chord as a short `playNote` downstream. The held-note bookkeeping, the lookahead timer and
 * the step grid itself live in StepStrategy (shared with the Euclidean sequencer); all that is
 * left here is "which pitch does this step play", which is the pure `arpPitch` math.
 */
import type { StrategyContext } from "../../strategy";
import type { MidiTransform } from "../../transform";
import { StepStrategy, type StepContext } from "../stepStrategy";
import { arpPitch, type ArpPattern } from "./pattern";
import { rateToBeats } from "../rate";
import { clamp } from "../../../../../util";

export class ArpStrategy extends StepStrategy {
  private readonly transform: Extract<MidiTransform, { kind: "arpeggiate" }>;

  constructor(transform: Extract<MidiTransform, { kind: "arpeggiate" }>, ctx: StrategyContext) {
    super(ctx);
    this.transform = transform;
  }

  protected stepBeats(): number {
    return rateToBeats(this.ctx.store.get(this.transform.rate) as string);
  }

  protected emitStep({ target, stepTime, stepSec, pitches, velocity, stepIndex }: StepContext): void {
    const store = this.ctx.store;
    const gate = clamp((store.get(this.transform.gate) as number) ?? 0.5, 0.05, 1);
    const pattern = store.get(this.transform.pattern) as ArpPattern;
    const octaves = (store.get(this.transform.octaves) as number) ?? 1;
    const pitch = arpPitch(pitches, pattern, octaves, stepIndex);
    if (pitch !== null) target.playNote(pitch, gate * stepSec, velocity, stepTime);
  }
}
