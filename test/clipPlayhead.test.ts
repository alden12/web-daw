/**
 * DAW-8.9: a clip editor's playhead is where the transport is in THAT clip, and nowhere when the
 * arrangement is not playing it. It used to be the arrangement position modulo the clip length, which
 * drew a moving cursor in a clip the arrangement had not reached.
 */
import { describe, expect, it } from "vitest";
import { clipBeatAt, tileClipNotes } from "../src/audio/sequencer/scheduler";

const placement = (startBeat: number, length: number, offset = 0, clipId = "c1") => ({
  clipId,
  startBeat,
  offset,
  length,
});

describe("clipBeatAt", () => {
  it("is null before the arrangement reaches the clip, and after it has passed", () => {
    const placements = [placement(8, 4)];
    expect(clipBeatAt(2, placements, "c1", 4)).toBeNull();
    expect(clipBeatAt(12, placements, "c1", 4)).toBeNull();
  });

  it("counts from the placement's start, not from beat 0", () => {
    expect(clipBeatAt(9.5, [placement(8, 4)], "c1", 4)).toBe(1.5);
  });

  it("wraps when a window outruns its clip, as the clip loops", () => {
    expect(clipBeatAt(8 + 5, [placement(8, 8)], "c1", 4)).toBe(1);
  });

  it("starts at the placement's offset into the clip", () => {
    expect(clipBeatAt(8, [placement(8, 4, 3)], "c1", 4)).toBe(3);
    expect(clipBeatAt(9, [placement(8, 4, 3)], "c1", 4)).toBe(0);
  });

  it("ignores placements of other clips on the same track", () => {
    expect(clipBeatAt(1, [placement(0, 4, 0, "other")], "c1", 4)).toBeNull();
  });

  it("puts the cursor exactly where the scheduler puts the notes", () => {
    // A note at clip beat 1, in a window starting at 8 with offset 3 on a 4-beat clip.
    const [first] = tileClipNotes([{ id: "n", pitch: 60, start: 1, length: 0.25, velocity: 1 }], 4, 3, 4);
    expect(clipBeatAt(8 + first.start, [placement(8, 4, 3)], "c1", 4)).toBe(1);
  });
});
