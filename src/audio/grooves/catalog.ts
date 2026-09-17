/**
 * The groove catalog: pure data (named timing/velocity templates), no audio/DOM -
 * shared by the scheduler, the transport UI, and the Node MCP server, like the
 * instrument/effect catalogs. A groove is applied **non-destructively at schedule
 * time** (see sequencer/groove.ts); it never edits stored notes.
 *
 * A groove tiles by its own period (`grid * slots.length`) from beat 0, so it is
 * meter-agnostic (no BEATS_PER_BAR dependency). Offsets are in beats - the codebase
 * has no PPQ/ticks.
 */

export interface GrooveSlot {
  /** Timing nudge for notes nearest this slot, in beats (+ = later). */
  offset: number;
  /** Velocity multiplier for notes nearest this slot (1 = unchanged). */
  velocityScale: number;
}

export interface Groove {
  id: string;
  name: string;
  /** Slot size in beats (e.g. 0.5 = eighth-note slots). */
  grid: number;
  slots: GrooveSlot[];
}

/**
 * A 2-slot swing template: every other `grid` step is pushed later. `pct` is the
 * swing ratio (0.5 = straight, ~0.66 = triplet feel); the off-step lands `pct` of
 * the way through the pair, so its offset is `(pct - 0.5) * (2 * grid)` beats.
 */
const swing = (grid: number, pct: number): GrooveSlot[] => [
  { offset: 0, velocityScale: 1 },
  { offset: (pct - 0.5) * grid * 2, velocityScale: 1 },
];

export const DEFAULT_GROOVE_ID = "straight";

export const GROOVES: Groove[] = [
  { id: "straight", name: "Straight", grid: 1, slots: [{ offset: 0, velocityScale: 1 }] },
  { id: "8th-54", name: "8th swing 54%", grid: 0.5, slots: swing(0.5, 0.54) },
  { id: "8th-58", name: "8th swing 58%", grid: 0.5, slots: swing(0.5, 0.58) },
  { id: "8th-62", name: "8th swing 62%", grid: 0.5, slots: swing(0.5, 0.62) },
  { id: "16th-55", name: "16th swing 55%", grid: 0.25, slots: swing(0.25, 0.55) },
  {
    // A light back-beat feel: a touch of 8th swing plus softer off-beats.
    id: "8th-accent",
    name: "8th accent",
    grid: 0.5,
    slots: [
      { offset: 0, velocityScale: 1 },
      { offset: (0.56 - 0.5) * 0.5 * 2, velocityScale: 0.82 },
    ],
  },
];

/** Resolve a groove by id, falling back to Straight (the no-op default). */
export const grooveById = (id: string): Groove => GROOVES.find((groove) => groove.id === id) ?? GROOVES[0];
