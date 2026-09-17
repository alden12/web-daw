/**
 * The OPFS-backed `LocalMirror` for a `SharedSession`: the durable local home for offline work, written
 * cache-only (never to the server). It stores the pending write-queue in the bundle's `pending.json` and
 * appends the confirmed edit stream to the same `edits.json` the read-through cache mirrors into - so an
 * offline reload replays keyframe + edit log back to HEAD and re-applies the still-unsent queue on top.
 *
 * Backed by a raw cache `BundleStore` (see `getLocalCacheBundle`), NOT the read-through `CachedBundleStore`,
 * because these writes must not round-trip to the authority (it owns its own keyframes / edit log).
 */
import type { BundleStore } from "../bundleStore";
import type { EditEntry } from "../commands/types";
import type { LocalMirror, PendingOp } from "./sharedSession";

const PENDING_PATH = "pending.json";

/** A `LocalMirror` over one project's OPFS cache bundle. */
export function bundleLocalMirror(bundle: BundleStore): LocalMirror {
  return {
    async loadPending(): Promise<PendingOp[]> {
      const raw = await bundle.readText(PENDING_PATH);
      if (!raw) return [];
      try {
        return JSON.parse(raw) as PendingOp[];
      } catch {
        return []; // a corrupt queue is discarded rather than crashing the session
      }
    },
    async savePending(pending: PendingOp[]): Promise<void> {
      await bundle.writeText(PENDING_PATH, JSON.stringify(pending));
    },
    async appendConfirmed(entry: EditEntry): Promise<void> {
      await bundle.appendEdits([entry]);
    },
  };
}
