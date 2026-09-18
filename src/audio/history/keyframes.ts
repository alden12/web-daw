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
 * The cost is storage and only storage: replaying a hundred thousand edits measures at 129ms on a
 * laptop and 182ms on a phone (DAW-39), so no reachable depth is slow enough to want a tighter
 * interval. Nine slots is roughly 450KB per normal project and 9MB per large one - twice the old
 * five-slot ring, for a reach that grows with the project rather than stopping at 2000 edits.
 *
 * Zero-dependency and DOM-free on purpose, like `paths.ts` next door: the authority
 * (`server/api/rooms.ts`) and the client (`projectRepository.ts`) both write this ring, and they
 * have to agree on the convention rather than each keeping a copy of it.
 */

/** Edits between retained keyframes. See the storage note above for why it is not tighter. */
export const KEYFRAME_RETAIN_INTERVAL = 500;

/**
 * How far back a rebuild can reach, which is how far back the CALLER's edit log goes - a base with
 * no entries above it to replay arrives nowhere, so one older than this reads as absent.
 *
 * This is the client's depth (`MAX_PERSISTED_ENTRIES`). The authority keeps far more
 * (`RETAINED_EDITS`, DAW-38) and passes its own via the `window` option, which is what lets a start
 * keyframe stay usable for a project's whole retained history rather than only its last two
 * thousand edits. Deliberately a default rather than a constant both sides share: they genuinely
 * differ, and pretending otherwise is how one of them silently replays from a base it cannot reach.
 */
export const KEYFRAME_RETAIN_WINDOW = 2000;

/**
 * Slots in the ring (DAW-38).
 *
 * Nine, and no longer derived from the interval, because the slots are no longer evenly spaced: the
 * ring keeps a GEOMETRIC ladder (see `planKeyframes`), so each extra slot roughly doubles the reach
 * instead of adding one interval to it. Nine rungs at 500, 1000, 2000 ... reach about 128,000 edits
 * back for twice the storage of the old five evenly-spaced ones.
 *
 * Reach is the point rather than speed. Undo rebuilds from the newest keyframe BELOW the edit being
 * taken back, so the ring - not the log - decides how far back undo goes at all. Someone offline for
 * a flight comes back to a head that has moved thousands of edits, and their own steps are only
 * undoable if a base still sits below them.
 */
export const KEYFRAME_RING_SIZE = 9;

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
 * The slot to overwrite when every one is taken: the most REDUNDANT rung, not the oldest (DAW-38).
 *
 * Evicting the oldest gives fixed spacing and therefore fixed reach - five slots 500 apart reach
 * 2000 edits and no further, however long the project runs. Evicting the most redundant instead
 * leaves the survivors to settle into a geometric ladder on their own: a rung is promoted up the
 * ladder as the head advances, rather than being rewritten.
 *
 * "Redundant" is the gap a rung's removal would open, measured against its own age. A young rung
 * with a close neighbour is cheap to lose, since the ladder is dense there anyway; an old one is
 * expensive, because nothing else covers that distance. Dividing by age is what makes the spacing
 * geometric rather than uniform.
 *
 * The oldest is never evicted - it is the reach, and the whole point. Nor is the one just written.
 */
const redundantSlot = (live: readonly { slot: number; seq: number }[], headSeq: number): number => {
  const ladder = [...live, { slot: -1, seq: headSeq }].sort((first, second) => first.seq - second.seq);
  const candidates = ladder.slice(1, -1).map((rung, index) => ({
    slot: rung.slot,
    // `index` counts from the first candidate, so its neighbours in `ladder` are at index and index + 2.
    cost: (ladder[index + 2].seq - ladder[index].seq) / Math.max(headSeq - rung.seq, 1),
  }));
  return candidates.reduce((cheapest, each) => (each.cost < cheapest.cost ? each : cheapest)).slot;
};

/**
 * Decide what to write, having just taken a head snapshot at `headSeq`.
 *
 * The slot chosen is an empty one, or failing that the most redundant rung (see `redundantSlot`).
 */
export function planKeyframes(
  index: KeyframeIndex,
  headSeq: number,
  options: { interval?: number; size?: number; window?: number } = {},
): KeyframePlan {
  const size = options.size ?? KEYFRAME_RING_SIZE;
  const interval = options.interval ?? KEYFRAME_RETAIN_INTERVAL;
  const floor = headSeq - (options.window ?? KEYFRAME_RETAIN_WINDOW);
  const slots = normalize(index, size);
  // Two ways a slot counts as free. A seq at or above head can only be stale (a rewound or
  // re-created project reusing the bundle). One below the retention floor has had the edits above it
  // pruned, so nothing can replay from it - `rebuildBase` already ignores those, and recycling the
  // slot puts it back to work instead of holding the ladder's oldest rung open forever.
  const live = slots.map((seq) => (seq !== null && seq < headSeq && seq >= floor ? seq : null));
  const newest = live.reduce<number | null>(
    (best, seq) => (seq !== null && (best === null || seq > best) ? seq : best),
    null,
  );
  if (newest !== null && headSeq - newest < interval) return { write: null, index: slots };

  const empty = live.indexOf(null);
  const slot =
    empty >= 0
      ? empty
      : redundantSlot(
          live.flatMap((seq, each) => (seq === null ? [] : [{ slot: each, seq }])),
          headSeq,
        );
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

/**
 * The OLDEST keyframe still usable as a rebuild base: the furthest back undo can reach.
 *
 * `rebuildBase` answers "what do I replay from to exclude this edit"; this answers "how far back
 * does undo go at all", which is what a reload needs in order to make edits from before it
 * undoable. Keyframes below the retention floor are skipped for the same reason as there - the
 * edits above them are gone, so nothing can be replayed from them.
 */
export function oldestBase(
  index: KeyframeIndex,
  headSeq: number,
  options: { window?: number; size?: number } = {},
): { slot: number; seq: number } | null {
  const floor = headSeq - (options.window ?? KEYFRAME_RETAIN_WINDOW);
  return normalize(index, options.size ?? KEYFRAME_RING_SIZE).reduce<{ slot: number; seq: number } | null>(
    (best, each, slot) =>
      each !== null && each <= headSeq && each >= floor && (best === null || each < best.seq)
        ? { slot, seq: each }
        : best,
    null,
  );
}
