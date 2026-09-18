/**
 * DAW-34 stage B: the retained keyframe ring, which gives a rebuild a base from BEFORE the edit it
 * is excluding. A fixed ring rather than a growing set, so nothing ever has to be deleted.
 */
import { describe, expect, it } from "vitest";
import {
  planKeyframes,
  rebuildBase,
  emptyKeyframeIndex,
  retainedKeyframePath,
  KEYFRAME_RING_SIZE,
  KEYFRAME_RETAIN_INTERVAL,
  KEYFRAME_RETAIN_WINDOW,
  KEYFRAME_INDEX_PATH,
  type KeyframeIndex,
} from "../src/audio/history/keyframes";
import { ProjectRepository } from "../src/audio/projectRepository";
import { MemoryBundleStore } from "../src/audio/bundleStore";
import { ProjectStore } from "../src/audio/project/projectStore";
import type { ProjectData } from "../src/audio/project/types";

/** A 3-slot ring keyframing every 100 edits, so the wrap-around is short enough to read. */
const plan = (index: KeyframeIndex, headSeq: number) => planKeyframes(index, headSeq, { interval: 100, size: 3 });

describe("planKeyframes", () => {
  it("fills the empty slots first", () => {
    expect(plan([null, null, null], 10)).toMatchObject({ write: { slot: 0, seq: 10 }, index: [10, null, null] });
    expect(plan([10, null, null], 110)).toMatchObject({ write: { slot: 1, seq: 110 }, index: [10, 110, null] });
  });

  it("waits out the interval before writing another", () => {
    expect(plan([10, null, null], 109).write).toBeNull();
    expect(plan([10, null, null], 110).write).not.toBeNull();
  });

  // Not the oldest, which is the reach and the whole point of keeping a ring at all (DAW-38). The
  // middle rung goes: its neighbours are 200 apart either side of it, and it is old enough that the
  // gap its removal opens is cheap relative to its age. What survives spreads out instead of sliding.
  it("overwrites the most redundant rung once the ring is full, so nothing is ever deleted", () => {
    expect(plan([10, 110, 210], 310)).toMatchObject({ write: { slot: 1, seq: 310 }, index: [10, 310, 210] });
    expect(plan([10, 310, 210], 410)).toMatchObject({ write: { slot: 2, seq: 410 }, index: [10, 310, 410] });
  });

  it("treats a seq at or above head as stale and takes its slot", () => {
    // A project rewound (or re-created into the same bundle) leaves keyframes from a future it no
    // longer has. They are not recent keyframes, and their slots are free.
    expect(plan([9000, 10, null], 110)).toMatchObject({ write: { slot: 0, seq: 110 }, index: [110, 10, null] });
  });

  it("heals an index that is the wrong shape rather than trusting it", () => {
    expect(planKeyframes([], 10, { size: 3 }).index).toEqual([10, null, null]);
    // A truncated or junk-filled index (hand-edited bundle, interrupted write) must not throw.
    expect(
      planKeyframes([10, undefined, "x"] as unknown as KeyframeIndex, 200, { interval: 100, size: 3 }).index,
    ).toEqual([10, 200, null]);
    expect(emptyKeyframeIndex()).toHaveLength(KEYFRAME_RING_SIZE);
  });

  /**
   * The property the ladder exists for, asserted by running it rather than by arithmetic: nine rungs
   * evenly spaced would reach 4500 edits, and that is the number this replaces.
   */
  it("settles into a ladder that reaches far further than even spacing would", () => {
    const window = 100_000;
    let index = emptyKeyframeIndex();
    for (let headSeq = 0; headSeq <= window; headSeq += KEYFRAME_RETAIN_INTERVAL) {
      index = planKeyframes(index, headSeq, { window }).index;
    }
    const behind = index.filter((seq): seq is number => seq !== null).map((seq) => window - seq);

    // Deep at the far end - orders of magnitude past what even spacing reaches.
    expect(Math.max(...behind)).toBeGreaterThan(40_000);
    // And still dense at the near end, where most undos land.
    expect(Math.min(...behind.filter((distance) => distance > 0))).toBeLessThanOrEqual(KEYFRAME_RETAIN_INTERVAL);
    expect(behind).toHaveLength(KEYFRAME_RING_SIZE);
  });

  // A rung below the retention floor has had the edits above it pruned, so nothing can replay from
  // it. Holding the slot would cost a rung of the ladder for a base that can no longer be used.
  it("recycles a rung the log has been pruned past", () => {
    expect(planKeyframes([10, 5000, 5100], 5200, { interval: 100, size: 3, window: 1000 })).toMatchObject({
      write: { slot: 0, seq: 5200 },
    });
  });
});

describe("rebuildBase", () => {
  const index: KeyframeIndex = [2000, 500, 1000, 1500, null];

  it("takes the newest keyframe strictly below the excluded edit", () => {
    // Strictly below, or the excluded edit is baked into the base and cannot be left out.
    expect(rebuildBase(index, 1600, 2000)).toMatchObject({ seq: 1500, slot: 3 });
    expect(rebuildBase(index, 1500, 2000)).toMatchObject({ seq: 1000, slot: 2 });
  });

  it("ignores a keyframe whose edits have been pruned, even though the file is still there", () => {
    // Window 600 at head 2000 puts the floor at 1400, so 500 and 1000 can no longer be replayed
    // from - the edits above them are gone.
    expect(rebuildBase(index, 1600, 2000, { window: 600 })).toMatchObject({ seq: 1500 });
    expect(rebuildBase(index, 1500, 2000, { window: 600 })).toBeNull();
  });

  it("is null when nothing reaches back that far, so the undo is refused rather than wrong", () => {
    expect(rebuildBase(index, 400, 2000)).toBeNull();
    expect(rebuildBase(emptyKeyframeIndex(), 400, 2000)).toBeNull();
  });
});

describe("retainedKeyframePath", () => {
  it("is addressed by slot, and kept apart from the write-once commit keyframes", () => {
    expect(retainedKeyframePath(2)).toBe("keyframes/2.json");
    expect(retainedKeyframePath(2)).not.toContain("history/");
  });
});

describe("KEYFRAME_RING_SIZE", () => {
  // The interval and the window are tuning knobs and need not divide. A fractional size is fatal:
  // `emptyKeyframeIndex` asks for `new Array(size)`, which throws on a non-integer.
  it("is a whole number of slots", () => {
    expect(Number.isInteger(KEYFRAME_RING_SIZE)).toBe(true);
    expect(() => emptyKeyframeIndex()).not.toThrow();
    expect(emptyKeyframeIndex()).toHaveLength(KEYFRAME_RING_SIZE);
  });

  // The invariant rounding up is there to protect: the slots behind the one being filled have to
  // reach back at least as far as the retained window, or undo cannot reach an edit the log still
  // holds. Rounding down would quietly break this.
  it("spans the retained window", () => {
    expect((KEYFRAME_RING_SIZE - 1) * KEYFRAME_RETAIN_INTERVAL).toBeGreaterThanOrEqual(KEYFRAME_RETAIN_WINDOW);
  });
});

describe("the ring, through the repository", () => {
  /** A project with one track, so a snapshot has something in it to tell copies apart. */
  const projectAt = (tempo: number): ProjectData => {
    const store = new ProjectStore(false);
    store.addTrack("subtractive", { id: "t-1" });
    store.setTempo(tempo);
    return store.snapshot();
  };

  const repoWith = () => {
    const store = new MemoryBundleStore();
    return { store, repo: new ProjectRepository(store, "p-test") };
  };

  it("writes a retained copy beside project.json, on the interval", async () => {
    const { store, repo } = repoWith();
    await repo.writeKeyframe(projectAt(100), 0);
    expect(JSON.parse((await store.readText(KEYFRAME_INDEX_PATH))!)[0]).toBe(0);

    // Too soon: project.json moves, the ring does not.
    await repo.writeKeyframe(projectAt(110), KEYFRAME_RETAIN_INTERVAL - 1);
    expect(JSON.parse((await store.readText(KEYFRAME_INDEX_PATH))!)[1]).toBeNull();

    await repo.writeKeyframe(projectAt(120), KEYFRAME_RETAIN_INTERVAL);
    expect(JSON.parse((await store.readText(KEYFRAME_INDEX_PATH))!)[1]).toBe(KEYFRAME_RETAIN_INTERVAL);
  });

  it("hands back the snapshot from BEFORE the excluded edit", async () => {
    const { repo } = repoWith();
    await repo.writeKeyframe(projectAt(100), 0);
    await repo.writeKeyframe(projectAt(120), KEYFRAME_RETAIN_INTERVAL);
    const headSeq = KEYFRAME_RETAIN_INTERVAL + 10;

    // Excluding an edit just after the second keyframe rebuilds from that one, not the first.
    const base = await repo.rebuildBaseFor(KEYFRAME_RETAIN_INTERVAL + 1, headSeq);
    expect(base).toMatchObject({ seq: KEYFRAME_RETAIN_INTERVAL });
    expect(base?.project.tempoBpm).toBe(120);

    // Excluding the edit AT that seq has to go further back, or the edit is baked into the base.
    const earlier = await repo.rebuildBaseFor(KEYFRAME_RETAIN_INTERVAL, headSeq);
    expect(earlier?.project.tempoBpm).toBe(100);
  });

  it("refuses rather than guesses when the ring does not reach back", async () => {
    const { repo } = repoWith();
    await repo.writeKeyframe(projectAt(100), 500);
    expect(await repo.rebuildBaseFor(400, 600)).toBeNull();
  });

  it("survives a bundle with no ring at all", async () => {
    const { repo } = repoWith();
    expect(await repo.rebuildBaseFor(10, 20)).toBeNull();
  });
});
