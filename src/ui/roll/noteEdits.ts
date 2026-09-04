/**
 * Note edits with a decision in them, kept out of the roll so the decision can be tested
 * without a browser (MOBILE-7).
 */
import type { NoteEvent } from "../../audio/sequencer/types";

/**
 * The pair of notes a split at `at` leaves behind, or **null when the point is not strictly
 * inside** the note - which is also what greys the action out rather than letting it produce a
 * zero-length note or a silent no-op.
 *
 * The head keeps the original's id, so the pair can be dispatched as one `addNotes`: that
 * command is insert-or-replace by id, so the shortened original and the new tail travel
 * together and a split is one undo step rather than an edit followed by an add.
 */
export function splitNoteAt(note: NoteEvent, at: number, tailId: string): [NoteEvent, NoteEvent] | null {
  if (at <= note.start || at >= note.start + note.length) return null;
  return [
    { ...note, length: at - note.start },
    { ...note, id: tailId, start: at, length: note.start + note.length - at },
  ];
}
