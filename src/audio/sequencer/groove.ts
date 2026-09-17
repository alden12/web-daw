/**
 * Applying a groove: map a note's position to its slot in the groove template and
 * return the timing nudge + velocity scale to use at schedule time. Pure and
 * DOM-free (shared by the scheduler and the tests); never mutates notes - the
 * scheduler adds `offsetBeats` to the note's `when` and multiplies its velocity.
 */
import type { Groove } from "../grooves/catalog";

export interface GrooveShift {
  /** Beats to push the note's onset later (or earlier, if negative). */
  offsetBeats: number;
  /** Multiplier applied to the note's velocity. */
  velocityScale: number;
}

const NONE: GrooveShift = { offsetBeats: 0, velocityScale: 1 };

/**
 * The shift for a note at `atBeat` under `groove`, scaled by `amount` (0 = no effect,
 * 1 = the full template). The groove tiles by its own period from beat 0; the note
 * takes the nearest slot's offset/velocity.
 */
export const grooveAt = (groove: Groove, atBeat: number, amount: number): GrooveShift => {
  if (amount <= 0 || groove.slots.length <= 1) return NONE;
  const period = groove.grid * groove.slots.length;
  const phase = ((atBeat % period) + period) % period;
  const slot = groove.slots[Math.round(phase / groove.grid) % groove.slots.length];
  return {
    offsetBeats: slot.offset * amount,
    velocityScale: 1 + (slot.velocityScale - 1) * amount,
  };
};
