import { describe, expect, it } from "vitest";
import { describeCommand } from "../src/audio/commands/describe";
import type { EditCommand } from "../src/audio/commands/types";

describe("describeCommand", () => {
  it("describes a known command", () => {
    expect(describeCommand({ type: "setTempo", bpm: 120 })).toBe("Set tempo 120");
  });

  it("falls back to the raw type for an unknown/legacy command (no crash)", () => {
    // A restored log may hold a pre-rename command type the map no longer knows.
    const legacy = { type: "addVariant", trackId: "t-1", id: "v-1" } as unknown as EditCommand;
    expect(describeCommand(legacy)).toBe("addVariant");
  });

  it("uses the instrument/effect label even without context", () => {
    expect(describeCommand({ type: "createTrack", instrumentType: "supersaw", id: "t-1" })).toBe(
      "Added Supersaw track",
    );
    expect(describeCommand({ type: "addEffect", hostId: "h-1", effectType: "tremolo", id: "fx-1" })).toBe(
      "Added Tremolo",
    );
  });

  it("resolves ids to names when given a context", () => {
    const ctx = { name: (id: string) => (id === "t-1" ? "Demo Organ" : undefined) };
    expect(describeCommand({ type: "createTrack", instrumentType: "organ", id: "t-1" }, ctx)).toBe(
      "Added Organ track Demo Organ",
    );
    expect(describeCommand({ type: "addEffect", hostId: "t-1", effectType: "tremolo", id: "fx-1" }, ctx)).toBe(
      "Added Tremolo to Demo Organ",
    );
    expect(
      describeCommand(
        { type: "addNotes", trackId: "t-1", notes: [{ id: "n", pitch: 60, start: 0, length: 1, velocity: 1 }] },
        ctx,
      ),
    ).toBe("Added 1 note to Demo Organ");
    // Unknown id degrades cleanly to the type-only phrasing.
    expect(describeCommand({ type: "setParam", trackId: "t-9", id: "amp.level", value: 1 }, ctx)).toBe("Set amp.level");
  });
});
