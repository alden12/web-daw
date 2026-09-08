/**
 * A short, stable fingerprint of a project snapshot (DAW-8.15).
 *
 * Used to stamp the persisted undo stacks with the state they were captured against, so a later load
 * can tell whether they still apply. The obvious stamp - the edit log's high-water `seq` - does not
 * work in a hosted session: the client coalesces a gesture into one local entry (one `seq`) while
 * forwarding every dispatch to the authority, which numbers them all, so the two counters drift apart
 * by design and the comparison never matches. The project state itself is the thing undo actually
 * needs to line up with, and it means the same thing in both persistence modes.
 *
 * Not a cryptographic hash and not a checksum for storage integrity: it only has to change when the
 * project does. A collision means restoring a stack captured against a different state, so it is
 * widened to 64 bits (two FNV-1a passes with different offset bases) plus the byte length.
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
