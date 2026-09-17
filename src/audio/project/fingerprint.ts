/**
 * A short, stable fingerprint of a project snapshot: "are these two projects the same?" in one value.
 *
 * **It is a test helper now.** It was written for DAW-8.15, to stamp the persisted undo stacks with
 * the state they were captured against so a later load could tell whether they still applied. That
 * guard is gone: an undo step is the id of a log entry (DAW-34 stages C and E), so a step that
 * names nothing excludes nothing and the stack needs no vouching for. What is left is the use the
 * rebuild suite makes of it - apply an edit, rebuild without it, assert the project came back to
 * the same place - where comparing one value beats comparing two deep objects field by field.
 *
 * Not a cryptographic hash and not a checksum for storage integrity: it only has to change when the
 * project does. Widened to 64 bits (two FNV-1a passes with different offset bases) plus the byte
 * length, so a collision does not quietly pass a rebuild that went wrong.
 */
import type { ProjectData } from "./types";

const FNV_PRIME = 0x01000193;

/** FNV-1a over the string's char codes. A char loop is the point here; `reduce` over 100KB is not. */
const fnv1a = (text: string, basis: number): number => {
  let hash = basis;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV_PRIME);
  }
  return hash >>> 0;
};

const hex = (value: number): string => value.toString(16).padStart(8, "0");

/**
 * Fingerprint a project snapshot. Deterministic because `snapshot()` builds its objects in a fixed
 * order, so `JSON.stringify` emits the same key order for the same state.
 */
export function fingerprintProject(project: ProjectData): string {
  const serialized = JSON.stringify(project);
  return `${hex(fnv1a(serialized, 0x811c9dc5))}${hex(fnv1a(serialized, 0x01000193))}-${serialized.length}`;
}
