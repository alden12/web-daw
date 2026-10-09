import { describe, expect, it, vi } from "vitest";
import { arrangementAddItems } from "../src/ui/arrangement/addItems";

describe("arrangementAddItems", () => {
  const groups = [
    { id: "g1", name: "Main" },
    { id: "g2", name: "Drums" },
  ];

  it("offers a track in each group, or in a fresh one", () => {
    const [, midi, audio] = arrangementAddItems(groups, vi.fn());
    for (const item of [midi, audio]) {
      expect(item.submenu?.map((entry) => entry.label)).toEqual(["Main", "Drums", "New group"]);
    }
  });

  it("puts a new track in the group chosen", () => {
    const dispatch = vi.fn();
    const [, midi] = arrangementAddItems(groups, dispatch);
    midi.submenu?.[1].onClick?.();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "createTrack", groupId: "g2" }));
  });

  it("makes the fresh group before the track that goes in it", () => {
    const dispatch = vi.fn();
    const [, , audio] = arrangementAddItems(groups, dispatch);
    audio.submenu?.at(-1)?.onClick?.();
    const [[group], [track]] = dispatch.mock.calls;
    expect(group.type).toBe("createGroup");
    expect(track).toMatchObject({ type: "createAudioTrack", groupId: group.id });
  });
});
