/**
 * DAW-34 stage E: offline undo depth is the ring, not luck.
 *
 * Reads on a hosted project go through a read-through cache, so a retained keyframe lands in the
 * offline cache the first time something reads it - and the only thing that reads one is an undo
 * that needs exactly that base. Going offline, the cache therefore held whichever slots an undo had
 * happened to want, which made offline undo depth a function of what you did beforehand. Warming
 * pulls the ring in once, while there is still a network.
 */
import { describe, expect, it } from "vitest";
import { ProjectRepository } from "../src/audio/projectRepository";
import { MemoryBundleStore, type BundleStore } from "../src/audio/bundleStore";
import { CachedBundleStore } from "../src/audio/cachedStore";
import { KEYFRAME_INDEX_PATH, retainedKeyframePath } from "../src/audio/history/keyframes";
import { ProjectStore } from "../src/audio/project/projectStore";

/** A remote that can be taken offline, counting the reads that reach it. */
class FlakyRemote extends MemoryBundleStore {
  online = true;
  readonly reads: string[] = [];
  override async readText(path: string): Promise<string | null> {
    if (!this.online) throw new Error("offline");
    this.reads.push(path);
    return super.readText(path);
  }
}

const keyframe = (headSeq: number) => JSON.stringify({ ...new ProjectStore(false).snapshot(), headSeq });

/** A remote holding a ring of `seqs` (one per slot) plus its index, behind a read-through cache. */
async function seeded(seqs: (number | null)[]) {
  const remote = new FlakyRemote();
  const cache = new MemoryBundleStore();
  await remote.writeText(KEYFRAME_INDEX_PATH, JSON.stringify(seqs));
  await Promise.all(
    seqs.map((seq, slot) => (seq === null ? undefined : remote.writeText(retainedKeyframePath(slot), keyframe(seq)))),
  );
  const store: BundleStore = new CachedBundleStore(remote, cache);
  return { remote, cache, repo: new ProjectRepository(store, "p1") };
}

const cachedSlots = async (cache: BundleStore, count: number): Promise<number[]> => {
  const held = await Promise.all(
    Array.from({ length: count }, async (_, slot) => ((await cache.readText(retainedKeyframePath(slot))) ? slot : -1)),
  );
  return held.filter((slot) => slot >= 0);
};

describe("warming the rebuild bases", () => {
  it("pulls every live ring slot into the offline cache", async () => {
    const { cache, repo } = await seeded([0, 500, 1000, 1500, 2000]);

    expect(await repo.warmRebuildBases(2000, cache)).toBe(5);
    expect(await cachedSlots(cache, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("leaves an empty slot alone", async () => {
    const { cache, repo } = await seeded([0, 500, null, null, null]);

    expect(await repo.warmRebuildBases(500, cache)).toBe(2);
    expect(await cachedSlots(cache, 5)).toEqual([0, 1]);
  });

  // A keyframe below the retention floor has had the edits above it pruned, so replaying forward from
  // it arrives nowhere. Fetching it would spend a snapshot's bandwidth on a base nothing can use.
  it("skips a slot the retention window no longer reaches", async () => {
    const { cache, repo } = await seeded([0, 2500, 3000]);

    expect(await repo.warmRebuildBases(3000, cache)).toBe(2);
    expect(await cachedSlots(cache, 3)).toEqual([1, 2]);
  });

  it("does not re-fetch a slot the cache already holds at that seq", async () => {
    const { remote, cache, repo } = await seeded([0, 500]);
    await repo.warmRebuildBases(500, cache);
    const before = remote.reads.length;

    expect(await repo.warmRebuildBases(500, cache)).toBe(2);
    // Only the index is read the second time; the two keyframes are already held.
    expect(remote.reads.slice(before)).toEqual([KEYFRAME_INDEX_PATH]);
  });

  // A slot is overwritten in turn, so a cached copy can be a keyframe that slot no longer holds.
  it("re-fetches a slot the ring has overwritten since", async () => {
    const { remote, cache, repo } = await seeded([0, 500]);
    await repo.warmRebuildBases(500, cache);

    await remote.writeText(retainedKeyframePath(0), keyframe(2500));
    await remote.writeText(KEYFRAME_INDEX_PATH, JSON.stringify([2500, 500]));
    const before = remote.reads.length;
    await repo.warmRebuildBases(2500, cache);

    expect(remote.reads.slice(before)).toContain(retainedKeyframePath(0));
    expect(JSON.parse((await cache.readText(retainedKeyframePath(0))) as string).headSeq).toBe(2500);
  });

  // The whole point: after warming, the bases are readable with no network at all.
  it("makes the ring readable once the network is gone", async () => {
    const { remote, cache, repo } = await seeded([0, 500, 1000]);
    await repo.warmRebuildBases(1000, cache);
    remote.online = false;

    expect(await repo.rebuildBaseFor(600, 1000)).toMatchObject({ seq: 500 });
    expect(await repo.oldestRebuildBase(1000)).toMatchObject({ seq: 0 });
  });

  // Before warming, the same offline read finds nothing - which is the luck this removes.
  it("finds nothing offline without it", async () => {
    const { remote, repo } = await seeded([0, 500, 1000]);
    remote.online = false;

    expect(await repo.rebuildBaseFor(600, 1000)).toBeNull();
  });

  it("is a no-op with no offline cache to warm", async () => {
    const { repo } = await seeded([0, 500]);
    expect(await repo.warmRebuildBases(500, null)).toBe(0);
  });

  // Best-effort, like the ring it copies: a fetch that fails costs undo depth, never data.
  it("reports what it managed rather than throwing when the network drops mid-warm", async () => {
    const { remote, cache, repo } = await seeded([0, 500]);
    await repo.warmRebuildBases(500, cache); // the index is cached by this
    await cache.writeText(retainedKeyframePath(1), "not json");
    remote.online = false;

    expect(await repo.warmRebuildBases(500, cache)).toBe(1);
  });
});
