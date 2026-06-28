/**
 * Quantization: pull note timings toward a grid. Pure and DOM-free, so the browser
 * UI and the Node MCP server share one implementation (like the catalogs). This is
 * the explicit counterpart to the ClipStore no longer force-snapping on input - notes
 * hold their true positions, and quantize is something you (or Claude) choose to apply.
 *
 * `GRID_DIVISIONS` is the single source for the grid choices, reused by the snap
 * dropdowns, the quantize controls, and the MCP `quantize` tool, so adding a division
 * (e.g. a triplet) shows up everywhere at once.
 */
import { GRID, type NoteEvent } from "./types";

/** Smallest length a quantized note keeps (mirrors ClipStore.MIN_LENGTH). */
const MIN_LENGTH = GRID;

/** A selectable grid resolution: a human label and its size in beats (4 beats = 1 bar). */
export interface GridDivision {
  label: string;
  beats: number;
}

/** The grid choices offered everywhere snapping/quantizing happens. */
export const GRID_DIVISIONS: GridDivision[] = [
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
  { label: "1/8T", beats: 1 / 3 },
  { label: "1/16T", beats: 1 / 6 },
];

/** Beats of the smallest division - the lower bound for a snap/quantize grid control. */
export const FINEST_DIVISION = Math.min(...GRID_DIVISIONS.map((division) => division.beats));

/** Look up a division's size in beats by its label (for the MCP enum). */
export const beatsForGrid = (label: string): number =>
  GRID_DIVISIONS.find((division) => division.label === label)?.beats ?? GRID;

export interface QuantizeSettings {
  /** Grid resolution in beats to quantize toward. */
  gridBeats: number;
  /** 0 = leave untouched, 1 = snap fully to grid; in between pulls partway. */
  strength: number;
  /** Quantize note ends too (lengths snap to grid); otherwise only starts move. */
  ends: boolean;
}

/** Pull a single beat value `strength` of the way toward its nearest grid line. */
export const quantizeBeat = (beat: number, gridBeats: number, strength: number): number => {
  const target = Math.round(beat / gridBeats) * gridBeats;
  return beat + (target - beat) * strength;
};

/**
 * Quantize a set of notes, returning new note objects (immutable). Starts are always
 * pulled toward the grid; with `ends`, the end is pulled too and the length recomputed
 * (floored to a 16th so a note can't vanish).
 */
export const quantizeNotes = (notes: NoteEvent[], settings: QuantizeSettings): NoteEvent[] =>
  notes.map((note) => {
    const start = Math.max(0, quantizeBeat(note.start, settings.gridBeats, settings.strength));
    if (!settings.ends) return { ...note, start };
    const end = quantizeBeat(note.start + note.length, settings.gridBeats, settings.strength);
    return { ...note, start, length: Math.max(MIN_LENGTH, end - start) };
  });
