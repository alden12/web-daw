import { describe, expect, it } from "vitest";
import { conflictKeys, keysOverlap, detectConflict, type AuthoredCommand } from "../src/audio/sync/conflict";
import type { EditCommand } from "../src/audio/commands/types";

const note = (id: string, start = 0): EditCommand => ({
  type: "editNotes",
  trackId: "t-1",
  notes: [{ id, pitch: 60, start, length: 1, velocity: 0.8 }],
});
const remove = (id: string): EditCommand => ({ type: "removeNotes", trackId: "t-1", ids: [id] });
const setParam = (trackId: string, id: string): EditCommand => ({ type: "setParam", trackId, id, value: 0.5 });
const rename = (trackId: string): EditCommand => ({ type: "setTrack", trackId, name: "x" });
const authored = (command: EditCommand, author = "them"): AuthoredCommand => ({ command, author });
const describe_ = (command: EditCommand): string => command.type;

describe("conflictKeys", () => {
  it("keys note edits by note id, not the enclosing track", () => {
    expect(conflictKeys(note("n-1"))).toEqual(["note:n-1"]);
    expect(conflictKeys(remove("n-1"))).toEqual(["note:n-1"]);
  });
  it("keys a param edit by the param, not the track", () => {
    expect(conflictKeys(setParam("t-1", "cutoff"))).toEqual(["param:t-1:cutoff"]);
  });
  it("keeps the track key for a command that targets the track itself", () => {
    expect(conflictKeys(rename("t-1"))).toEqual(["track:t-1"]);
  });
  it("keys project-level commands by facet", () => {
    expect(conflictKeys({ type: "setTempo", bpm: 120 })).toEqual(["project:tempo"]);
    expect(conflictKeys({ type: "renameProject", name: "x" })).toEqual(["project:name"]);
  });
});

describe("keysOverlap", () => {
  it("matches exact keys and prefix (container) keys", () => {
    expect(keysOverlap(["note:n-1"], ["note:n-1"])).toBe(true);
    expect(keysOverlap(["note:n-1"], ["note:n-2"])).toBe(false);
    expect(keysOverlap(["param:t-1:"], ["param:t-1:cutoff"])).toBe(true); // removeTrack prefix vs a param
    expect(keysOverlap(["param:t-1:cutoff"], ["param:t-2:cutoff"])).toBe(false);
  });
});

describe("detectConflict", () => {
  it("flags a clash when peer and I touch the same note", () => {
    const info = detectConflict([authored(remove("n-1"), "alice")], [authored(note("n-1"), "you")], describe_);
    expect(info).not.toBeNull();
    expect(info!.theirs).toHaveLength(1);
    expect(info!.mine).toHaveLength(1);
  });
  it("does not flag edits to different notes on the same track", () => {
    expect(detectConflict([authored(note("n-2"))], [authored(note("n-1"))], describe_)).toBeNull();
  });
  it("does not flag a param edit against a note edit on the same track", () => {
    expect(detectConflict([authored(setParam("t-1", "cutoff"))], [authored(note("n-1"))], describe_)).toBeNull();
  });
  it("collapses a repeated drag on one note to a single line", () => {
    const drag = [authored(note("n-1", 1)), authored(note("n-1", 2)), authored(note("n-1", 3))];
    const info = detectConflict([authored(remove("n-1"), "alice")], drag, describe_);
    expect(info!.mine).toHaveLength(1); // deduped by description
  });
  it("returns null when either side is empty", () => {
    expect(detectConflict([], [authored(note("n-1"))], describe_)).toBeNull();
    expect(detectConflict([authored(note("n-1"))], [], describe_)).toBeNull();
  });
});
