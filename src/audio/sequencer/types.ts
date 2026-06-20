/**
 * The song-data model: a clip of MIDI notes. This is the sequencer's analogue of
 * the parameter schema - one declarative model that the piano roll, the
 * scheduler, MCP, and persistence all consume. Timing is musical (beats); the
 * scheduler converts beats to seconds using the tempo.
 */

export interface NoteEvent {
  id: string;
  /** MIDI note number, 0-127. */
  pitch: number;
  /** Onset in beats from the start of the clip. */
  start: number;
  /** Duration in beats. */
  length: number;
  /** 0..1. */
  velocity: number;
}

export interface ClipData {
  notes: NoteEvent[];
  /** Loop length in beats. Tempo is project-level (see ProjectStore). */
  lengthBeats: number;
}

/** Grid resolution in beats (1/4 beat = sixteenth notes in 4/4). */
export const GRID = 0.25;
