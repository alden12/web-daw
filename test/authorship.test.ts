import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import {
  authorshipEffect,
  noteEditClipTarget,
  trackKey,
  noteKey,
  paramKey,
  clipKey,
} from "../src/audio/commands/authorship";
import { colorForAuthor, SWATCHES } from "../src/ui/authorColors";
import { DEFAULT_VOICE_COLORS } from "../src/ui/authorVoice";

describe("authorshipEffect - command -> object keys", () => {
  it("stamps the track for a create, plus finer keys for notes and params", () => {
    expect(authorshipEffect({ type: "createTrack", id: "t1", instrumentType: "subtractive" }).touched).toEqual([
      trackKey("t1"),
    ]);
    expect(
      authorshipEffect({
        type: "addNotes",
        trackId: "t1",
        notes: [
          { id: "n1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
          { id: "n2", pitch: 64, start: 1, length: 1, velocity: 0.8 },
        ],
      }).touched,
    ).toEqual([trackKey("t1"), noteKey("n1"), noteKey("n2")]);
    expect(authorshipEffect({ type: "setParam", trackId: "t1", id: "cutoff", value: 1 }).touched).toEqual([
      trackKey("t1"),
      paramKey("t1", "cutoff"),
    ]);
  });

  it("forgets removed objects: exact keys and by prefix on track removal", () => {
    expect(authorshipEffect({ type: "removeNote", trackId: "t1", id: "n1" }).removed).toEqual([noteKey("n1")]);
    // Removing a track clears its param authorship by prefix so it does not linger.
    expect(authorshipEffect({ type: "removeTrack", trackId: "t1" }).removed).toContain("param:t1:");
    expect(authorshipEffect({ type: "removeTrack", trackId: "t1" }).removed).toContain(trackKey("t1"));
  });

  it("tints no object for project-level commands", () => {
    expect(authorshipEffect({ type: "setTempo", bpm: 128 })).toEqual({});
  });

  it("identifies the clip a note edit targets (for the timeline block colour)", () => {
    expect(noteEditClipTarget({ type: "editNotes", trackId: "t1", notes: [] })).toEqual({
      trackId: "t1",
      clipId: undefined,
    });
    expect(noteEditClipTarget({ type: "setTempo", bpm: 120 })).toBeNull();
  });
});

describe("authorship through dispatch + snapshot", () => {
  it("records the dispatching author per object and reads it back", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" }, "claude");
    log.dispatch({ type: "setParam", trackId: "t1", id: "amp.level", value: 0.5 }, "you");

    expect(store.authorOf(trackKey("t1"))).toBe("you"); // last touch on the track was the param edit
    expect(store.authorOf(paramKey("t1", "amp.level"))).toBe("you");
  });

  it("stamps the active clip when its notes are edited, so its timeline block follows note authorship", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" }, "you");
    const clipId = store.getTrack("t1")!.activeClipId!;
    log.dispatch(
      { type: "addNotes", trackId: "t1", notes: [{ id: "n1", pitch: 60, start: 0, length: 1, velocity: 0.8 }] },
      "agent",
    );
    expect(store.authorOf(clipKey(clipId))).toBe("agent");
  });

  it("survives a snapshot -> load round-trip (persistence / project switch)", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" }, "agent");
    const snapshot = store.snapshot();

    const restored = new ProjectStore();
    restored.load(snapshot);
    expect(restored.authorOf(trackKey("t1"))).toBe("agent");
  });

  it("reverts with undo, because authorship rides the snapshot", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" }, "you");
    log.dispatch({ type: "setParam", trackId: "t1", id: "amp.level", value: 0.5 }, "claude");
    expect(store.authorOf(paramKey("t1", "amp.level"))).toBe("claude");

    log.undo();
    // The param edit is undone, so its authorship is gone (restored to the pre-edit snapshot).
    expect(store.authorOf(paramKey("t1", "amp.level"))).toBeUndefined();
    expect(store.authorOf(trackKey("t1"))).toBe("you");
  });
});

describe("authorship reactivity - the tint refreshes on a change of voice", () => {
  it("notifies subscribers when a human takes over an agent-set param (so the colour flips immediately)", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" }, "you");
    // The agent sets a param; then a human re-sets the same param. The second edit must emit so the
    // slider re-renders with the human colour, rather than staying on the agent colour until an
    // unrelated re-render (e.g. pressing play) happens to refresh it.
    log.dispatch({ type: "setParam", trackId: "t1", id: "amp.level", value: 0.5 }, "claude");

    let notifications = 0;
    const unsubscribe = store.subscribe(() => (notifications += 1));
    log.dispatch({ type: "setParam", trackId: "t1", id: "amp.level", value: 0.7 }, "you");
    unsubscribe();

    expect(notifications).toBeGreaterThan(0);
    expect(store.authorOf(paramKey("t1", "amp.level"))).toBe("you");
  });

  it("does not emit when the same author re-stamps a key (a knob drag stays rebuild-free per frame)", () => {
    const store = new ProjectStore();
    const log = new EditLog(store);
    log.dispatch({ type: "createTrack", id: "t1", instrumentType: "subtractive" }, "you");
    log.dispatch({ type: "setParam", trackId: "t1", id: "amp.level", value: 0.3 }, "you");

    let notifications = 0;
    const unsubscribe = store.subscribe(() => (notifications += 1));
    // Re-stamp the same "you" author repeatedly (as consecutive drag frames do): authorship is
    // unchanged, so no emit fires from the authorship seam.
    store.setAuthor(paramKey("t1", "amp.level"), "you");
    store.setAuthor(paramKey("t1", "amp.level"), "you");
    unsubscribe();

    expect(notifications).toBe(0);
  });
});

describe("colorForAuthor", () => {
  it("uses the voice default when unset and a config override when set", () => {
    expect(colorForAuthor("you", {})).toBe(DEFAULT_VOICE_COLORS.you);
    expect(colorForAuthor("you", { you: "#123456" })).toBe("#123456");
  });

  it("hashes an unknown author id to a stable palette colour (the multi-user seam)", () => {
    const first = colorForAuthor("user-abc", {});
    expect(SWATCHES.some((swatch) => swatch.hex === first)).toBe(true);
    expect(colorForAuthor("user-abc", {})).toBe(first); // deterministic
  });
});
