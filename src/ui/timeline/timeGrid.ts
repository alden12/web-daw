/**
 * The time<->pixel grid: the shared geometry behind any beat-based view (the
 * piano roll now, the arrangement timeline next). Pure functions of a single
 * `pxPerBeat` zoom factor, so the same mapping drives the ruler, the note grid,
 * and the velocity lane - and later the arrangement lanes - with no per-view
 * duplication. Musical time is in beats; `GRID` (sequencer/types) is the finest
 * snap. The meter comes from the project time signature (default 4/4).
 */
import { GRID } from "../../audio/sequencer/types";
import { DEFAULT_TIME_SIGNATURE, beatUnitBeats } from "../../audio/project/schema";
import type { TimeSignature } from "../../audio/project/types";

/** Beats -> x pixels. */
export const beatToX = (beat: number, pxPerBeat: number): number => beat * pxPerBeat;

/** X pixels -> beats (the inverse of beatToX). */
export const xToBeat = (x: number, pxPerBeat: number): number => x / pxPerBeat;

/** Snap a beat to the nearest multiple of `division` (e.g. GRID, 0.5, 1). */
export const snapBeat = (beat: number, division: number = GRID): number => Math.round(beat / division) * division;

/** Floor a beat to its grid cell start (used when adding a note in a clicked cell). */
export const floorBeat = (beat: number, division: number = GRID): number => Math.floor(beat / division) * division;

/**
 * How far a dragged selection should actually move: **snap the destination, not the movement**
 * (DAW-8.8).
 *
 * The obvious version, `place(pointerMovement)`, is wrong in a way that only shows on content
 * that did not start on the grid. It preserves the anchor's remainder forever - a note recorded
 * at 0.37 dragged by a snapped 0.5 lands on 0.87, and no amount of dragging ever gets it onto a
 * line. Snapping where the anchor is *going* fixes the onset on the first drag.
 *
 * `anchor` is the edge being dragged (a note's start for a move, the end under the pointer for a
 * resize), and `place` is snap plus whatever clamping that edge is subject to. Returns a delta
 * rather than a position because the rest of the selection moves by the same amount, which is
 * what keeps a chord's internal spacing intact.
 */
export const snapDelta = (anchor: number, movement: number, place: (beat: number) => number): number =>
  place(anchor + movement) - anchor;

export interface BeatTick {
  beat: number;
  /** True at the start of a bar (gets a heavier line + a bar-number label). */
  isBar: boolean;
  /** 1-based bar number, only set when isBar. */
  bar?: number;
}

/**
 * Ticks at every shown beat (the time signature's `beatUnitBeats` - a quarter in x/4, an eighth in
 * x/8) from 0..lengthBeats inclusive, flagging bar starts. The trailing tick at `lengthBeats` marks
 * the loop end. Iterating by tick *index* (not by accumulating beats) keeps the bar test exact for
 * fractional bars (7/8 bars every 3.5 beats), so the heavy bar line always lands on a tick.
 */
export function beatTicks(lengthBeats: number, timeSignature: TimeSignature = DEFAULT_TIME_SIGNATURE): BeatTick[] {
  const beatUnit = beatUnitBeats(timeSignature); // beats per shown beat
  const beatsPerBarUnits = timeSignature.numerator; // shown beats per bar
  const ticks: BeatTick[] = [];
  for (let index = 0; index * beatUnit <= lengthBeats + 1e-9; index += 1) {
    const beat = index * beatUnit;
    const isBar = index % beatsPerBarUnits === 0;
    ticks.push(isBar ? { beat, isBar, bar: index / beatsPerBarUnits + 1 } : { beat, isBar });
  }
  return ticks;
}
