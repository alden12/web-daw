/**
 * The `euclid` strategy: a Torso T-1 style Euclidean sequencer. It walks the same tempo step
 * grid as the arpeggiator (StepStrategy does that bookkeeping), but instead of playing every
 * step it plays only the steps the Euclidean pattern marks as onsets - `pulses` hits spread as
 * evenly as possible over `steps`, turned by `rotate`.
 *
 * Like the arp, it is driven by what is *held*: hold a chord (or park one long note in a clip)
 * and the device turns it into a rhythm. `voicing` decides what an onset plays - the whole chord,
 * or the next pitch of it walked like an arp. `repeats` retriggers inside a single step (the T-1's
 * ratchet), and `accent` drops the velocity of everything that isn't the cycle's first hit.
 *
 * Everything here is a pure read of the params at schedule time, so automating steps/pulses/rotate
 * mid-phrase re-shapes the rhythm on the next lookahead window with no extra state to invalidate.
 */
import type { StrategyContext } from "../../strategy";
import type { MidiTransform } from "../../transform";
import { StepStrategy, type StepContext } from "../stepStrategy";
import { euclideanPattern } from "./pattern";
import { rateToBeats } from "../rate";
import { arpPitch, type ArpPattern } from "../arp/pattern";
import { clamp } from "../../../../../util";

/** How an onset picks its pitch(es) from the held chord. */
export type EuclidVoicing = "chord" | "up" | "down" | "updown" | "random";

export class EuclidStrategy extends StepStrategy {
  private readonly transform: Extract<MidiTransform, { kind: "euclid" }>;

  constructor(transform: Extract<MidiTransform, { kind: "euclid" }>, ctx: StrategyContext) {
    super(ctx);
    this.transform = transform;
  }

  private readNumber(paramId: string, fallback: number): number {
    const value = this.ctx.store.get(paramId);
    return typeof value === "number" ? value : fallback;
  }

  protected stepBeats(): number {
    return rateToBeats(this.ctx.store.get(this.transform.rate) as string);
  }

  protected emitStep({ target, stepTime, stepSec, pitches, velocity, stepIndex }: StepContext): void {
    const pattern = euclideanPattern(
      this.readNumber(this.transform.steps, 16),
      this.readNumber(this.transform.pulses, 4),
      this.readNumber(this.transform.rotate, 0),
    );
    const position = ((stepIndex % pattern.length) + pattern.length) % pattern.length;
    if (!pattern[position]) return;

    const gate = clamp(this.readNumber(this.transform.gate, 0.5), 0.05, 1);
    const accent = clamp(this.readNumber(this.transform.accent, 0), 0, 1);
    const repeats = Math.max(1, Math.round(this.readNumber(this.transform.repeats, 1)));
    const voicing = this.ctx.store.get(this.transform.voicing) as EuclidVoicing;

    // The cycle's first hit keeps full velocity; `accent` scales down every other hit, so a
    // rotated pattern still lands its accent on a real onset rather than a rest.
    const onsetsBefore = pattern.slice(0, position).filter(Boolean).length;
    const scaledVelocity = velocity * (onsetsBefore === 0 ? 1 : 1 - accent);

    // Voiced onsets walk the chord per *hit*, not per step, so silent steps don't advance the
    // melody. The index is derived from the pattern (pure), not carried as state.
    const onsetIndex = Math.floor(stepIndex / pattern.length) * pattern.filter(Boolean).length + onsetsBefore;
    const voiced = voicing === "chord" ? pitches : [arpPitch(pitches, voicing as ArpPattern, 1, onsetIndex)];

    const repeatSec = stepSec / repeats;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const when = stepTime + repeat * repeatSec;
      for (const pitch of voiced) {
        if (pitch !== null) target.playNote(pitch, gate * repeatSec, scaledVelocity, when);
      }
    }
  }
}
