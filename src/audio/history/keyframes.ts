/**
 * Retained keyframes: the rebuild bases undo needs (DAW-34 stage B).
 *
 * `project.json` is a single overwritten path, so the only snapshot a project has is always NEWER
 * than the edit you want to take back. Rebuilding the project without an edit needs a base from
 * BEFORE it, so a few older snapshots are kept alongside the head one.
 *
 * **A fixed ring of slots, not a growing set of files.** Nothing in the stack can delete one file
 * from a bundle - not `BundleStore`, not the server's file store, not the HTTP API - and adding a
 * delete through three layers to support pruning would be a sharp tool bought for a small job. A
 * ring needs none of it: a new keyframe OVERWRITES the slot holding the oldest one, so storage is
 * bounded by construction at exactly `KEYFRAME_RING_SIZE` snapshots per project, forever.
 *
 * The cost is storage and only storage: a rebuild replaying the whole retained window measures at
 * 4ms on a normal project and 24ms on a large one, so a tighter interval buys nothing worth having.
 * 500 sits one notch off the cheapest option purely for headroom, at roughly 250KB per normal
 * project and 5MB per large one.
 *
 * Zero-dependency and DOM-free on purpose, like `paths.ts` next door: the authority
 * (`server/api/rooms.ts`) and the client (`projectRepository.ts`) both write this ring, and they
 * have to agree on the convention rather than each keeping a copy of it.
 */

/** Edits between retained keyframes. See the storage note above for why it is not tighter. */
export const KEYFRAME_RETAIN_INTERVAL = 500;

/** How far back the edit log is kept, and so how far back a rebuild can reach. Matches the
 *  authority's `SNAPSHOT_WINDOW` and the client's `MAX_PERSISTED_ENTRIES`. */
export const KEYFRAME_RETAIN_WINDOW = 2000;

/** Slots in the ring: enough to span the window, plus the one currently being filled. */
export const KEYFRAME_RING_SIZE = KEYFRAME_RETAIN_WINDOW / KEYFRAME_RETAIN_INTERVAL + 1;

/**
 * Storage path for a retained keyframe, addressed by RING SLOT rather than by seq - that is what
 * makes a write an overwrite instead of an unbounded new file.
 *
 * Deliberately a different prefix from `history/keyframes/` (see `paths.ts`), which pins a snapshot
 * at a COMMIT: those are write-once, keyed by seq, and kept forever.
 */
export const retainedKeyframePath = (slot: number): string => `keyframes/${slot}.json`;

/** Which seq each slot currently holds. `BundleStore` cannot list a prefix and a slot's name says
 *  nothing about its contents, so the mapping is recorded - one small write beside each keyframe. */
export const KEYFRAME_INDEX_PATH = "keyframes/index.json";

/** Seq per slot; null where the slot has never been written. Length is `KEYFRAME_RING_SIZE`. */
export type KeyframeIndex = readonly (number | null)[];

export interface KeyframePlan {
  /** Slot to write the snapshot into, or null when the interval has not elapsed yet. */
  readonly write: { readonly slot: number; readonly seq: number } | null;
  /** The index as it should be stored afterwards. */
  readonly index: KeyframeIndex;
}

/** An index of the right length, however malformed (or absent) the stored one was. */
export const emptyKeyframeIndex = (size = KEYFRAME_RING_SIZE): KeyframeIndex =>
  new Array<number | null>(size).fill(null);

const normalize = (index: KeyframeIndex, size: number): (number | null)[] =>
  Array.from({ length: size }, (_, slot) => {
    const seq = index[slot];
    return typeof seq === "number" && Number.isFinite(seq) ? seq : null;
  });

/**
 * Decide what to write, having just taken a head snapshot at `headSeq`.
 *
 * The slot chosen is an empty one, or failing that the one holding the oldest seq - which is the
 * keyframe furthest past its usefulness, since a base only helps while the edits above it survive.
 */
export function planKeyframes(
  index: KeyframeIndex,
  headSeq: number,
  options: { interval?: number; size?: number } = {},
): KeyframePlan {
  const size = options.size ?? KEYFRAME_RING_SIZE;
  const interval = options.interval ?? KEYFRAME_RETAIN_INTERVAL;
  const slots = normalize(index, size);
  // A seq at or above head can only be stale (a rewound or re-created project reusing the bundle),
  // so it does not count as a recent keyframe and its slot is free to take.
  const live = slots.map((seq) => (seq !== null && seq < headSeq ? seq : null));
  const newest = live.reduce<number | null>(
    (best, seq) => (seq !== null && (best === null || seq > best) ? seq : best),
    null,
  );
  if (newest !== null && headSeq - newest < interval) return { write: null, index: slots };

  const empty = live.indexOf(null);
  const slot =
    empty >= 0
      ? empty
      : live
          .map((seq, each) => ({ seq: seq ?? Number.POSITIVE_INFINITY, each }))
          .reduce((oldest, candidate) => (candidate.seq < oldest.seq ? candidate : oldest)).each;
  const written = [...slots];
  written[slot] = headSeq;
  return { write: { slot, seq: headSeq }, index: written };
}

/**
 * The keyframe to rebuild from when excluding edit `seq`: the newest one strictly BELOW it, so the
 * excluded edit falls in the replayed tail rather than being baked into the base.
 *
 * A keyframe older than the retention window is ignored even though its file is still there: the
 * edits between it and the floor have been pruned, so replaying forward from it cannot arrive
 * anywhere. Null means the undo is out of reach, which is what makes it refused rather than wrong.
 */
export function rebuildBase(
  index: KeyframeIndex,
  seq: number,
  headSeq: number,
  options: { window?: number; size?: number } = {},
): { slot: number; seq: number } | null {
  const floor = headSeq - (options.window ?? KEYFRAME_RETAIN_WINDOW);
  return normalize(index, options.size ?? KEYFRAME_RING_SIZE).reduce<{ slot: number; seq: number } | null>(
    (best, each, slot) =>
      each !== null && each < seq && each >= floor && (best === null || each > best.seq) ? { slot, seq: each } : best,
    null,
  );
}
