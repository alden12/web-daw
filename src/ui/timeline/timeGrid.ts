/**
 * The time<->pixel grid: the shared geometry behind any beat-based view (the
 * piano roll now, the arrangement timeline next). Pure functions of a single
 * `pxPerBeat` zoom factor, so the same mapping drives the ruler, the note grid,
 * and the velocity lane - and later the arrangement lanes - with no per-view
 * duplication. Musical time is in beats; `GRID` (sequencer/types) is the finest
 * snap. 4/4 is assumed (beatsPerBar = 4) until time signatures land.
 */
import { GRID } from '../../audio/sequencer/types';

export const DEFAULT_BEATS_PER_BAR = 4;

/** Beats -> x pixels. */
export const beatToX = (beat: number, pxPerBeat: number): number => beat * pxPerBeat;

/** X pixels -> beats (the inverse of beatToX). */
export const xToBeat = (x: number, pxPerBeat: number): number => x / pxPerBeat;

/** Snap a beat to the nearest multiple of `division` (e.g. GRID, 0.5, 1). */
export const snapBeat = (beat: number, division: number = GRID): number =>
  Math.round(beat / division) * division;

/** Floor a beat to its grid cell start (used when adding a note in a clicked cell). */
export const floorBeat = (beat: number, division: number = GRID): number =>
  Math.floor(beat / division) * division;

export interface BeatTick {
  beat: number;
  /** True at the start of a bar (gets a heavier line + a bar-number label). */
  isBar: boolean;
  /** 1-based bar number, only set when isBar. */
  bar?: number;
}

/**
 * Ticks at every whole beat from 0..lengthBeats inclusive, flagging bar starts.
 * The trailing tick at `lengthBeats` marks the loop end.
 */
export function beatTicks(lengthBeats: number, beatsPerBar: number = DEFAULT_BEATS_PER_BAR): BeatTick[] {
  const ticks: BeatTick[] = [];
  for (let beat = 0; beat <= lengthBeats; beat += 1) {
    const isBar = beat % beatsPerBar === 0;
    ticks.push(isBar ? { beat, isBar, bar: beat / beatsPerBar + 1 } : { beat, isBar });
  }
  return ticks;
}
