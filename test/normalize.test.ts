/**
 * DAW-36: a dispatched command must carry what it needs, so a log entry says what it actually did
 * rather than what it would do against whatever state happens to be current.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { applyEdit } from "../src/audio/commands/applyEdit";
import { normalizeCommand, normalizedTypes } from "../src/audio/commands/normalize";
import type { EditCommand } from "../src/audio/commands/types";

/** A track with two clips in its pool, the second of them active. */
function seeded() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
  log.dispatch({ type: "addClip", trackId: "t-1", id: "c-2", empty: true });
  return { project, log };
}

const note = (id: string) => ({ id, start: 0, lengthBeats: 1, pitch: 60, velocity: 100 });

describe("normalizeCommand", () => {
  it("pins a note edit to the clip it landed in", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "addNote", trackId: "t-1", note: note("n-1") });

    const entry = log.getEntries().at(-1);
    expect(entry?.command).toMatchObject({ type: "addNote", clipId: "c-2" });
    expect(project.getClipStore("t-1", "c-2")?.getClip().notes).toHaveLength(1);
  });

  it("leaves a command that already names its clip alone", () => {
    const { project } = seeded();
    const command: EditCommand = { type: "addNote", trackId: "t-1", clipId: "c-t-1", note: note("n-1") };
    expect(normalizeCommand(project, command)).toBe(command);
  });

  it("passes through a command whose track does not exist, rather than inventing a clip", () => {
    const { project } = seeded();
    const command: EditCommand = { type: "clearClip", trackId: "nope" };
    expect(normalizeCommand(project, command)).toBe(command);
  });

  it("leaves types with no ambient default untouched", () => {
    const { project } = seeded();
    const command: EditCommand = { type: "setTempo", bpm: 91 };
    expect(normalizeCommand(project, command)).toBe(command);
  });

  it("only claims the types it actually resolves", () => {
    expect(normalizedTypes().sort()).toEqual(
      [
        "addNote",
        "addNotes",
        "editNotes",
        "removeNote",
        "removeNotes",
        "clearClip",
        "setClipLength",
        "createTrack",
        "createTrackFromPatch",
        "createAudioTrack",
        "addAudioTrack",
        "addAudioClip",
        "addClip",
        "addPlacement",
      ].sort(),
    );
  });

  it("pins the name a new track would have taken from the track count", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-2" });

    const entry = log.getEntries().at(-1);
    expect(entry?.command).toMatchObject({ type: "createTrack", name: project.getTrack("t-2")?.name });
    expect(entry?.command).toHaveProperty("name", expect.stringMatching(/ 2$/));
  });

  it("pins the clip a new clip forks, and the length it starts at", () => {
    const { log } = seeded();
    log.dispatch({ type: "addClip", trackId: "t-1", id: "c-3" });

    // c-2 was active, so that is what it forked - not "whatever is active at replay time".
    expect(log.getEntries().at(-1)?.command).toMatchObject({
      type: "addClip",
      fromClipId: "c-2",
      name: "C",
      lengthBeats: expect.any(Number),
    });
  });

  it("pins the clip and length a placement got", () => {
    const { log } = seeded();
    log.dispatch({ type: "addPlacement", trackId: "t-1", id: "p-2", startBeat: 8 });

    expect(log.getEntries().at(-1)?.command).toMatchObject({
      type: "addPlacement",
      clipId: "c-2",
      length: expect.any(Number),
    });
  });

  // Everything below states the property directly: take the entry the log KEPT, apply it to a
  // project whose state has moved on, and the result must not follow that state. Replaying the log
  // in order would prove nothing - it reproduces the very state the command used to read.

  it("a logged note edit lands in the clip it named, wherever another is active", () => {
    const { log } = seeded();
    log.dispatch({ type: "addNote", trackId: "t-1", note: note("n-1") });
    const logged = log.getEntries().at(-1)!.command;

    const elsewhere = new ProjectStore(false); // a fresh project: c-t-1 is the active clip, c-2 is not
    applyEdit(elsewhere, { type: "createTrack", instrumentType: "subtractive", id: "t-1" }, "you");
    applyEdit(elsewhere, { type: "addClip", trackId: "t-1", id: "c-2", empty: true }, "you");
    applyEdit(elsewhere, { type: "launchClip", trackId: "t-1", clipId: "c-t-1" }, "you");
    elsewhere.selectClip("t-1", "c-t-1");
    applyEdit(elsewhere, logged, "you");

    expect(
      elsewhere
        .getClipStore("t-1", "c-2")
        ?.getClip()
        .notes.map((each) => each.id),
    ).toEqual(["n-1"]);
    expect(elsewhere.getClipStore("t-1", "c-t-1")?.getClip().notes).toHaveLength(0);
  });

  // An empty clip seeds its length from the PROJECT length.
  it("a logged empty clip keeps the length the project had when it was made", () => {
    const { log } = seeded();
    log.dispatch({ type: "setLength", lengthBeats: 32 });
    log.dispatch({ type: "addClip", trackId: "t-1", id: "c-3", empty: true });
    const logged = log.getEntries().at(-1)!.command;

    const longer = seeded().project;
    longer.setLength(128);
    applyEdit(longer, logged, "you");

    expect(longer.getClipStore("t-1", "c-3")?.getClip().lengthBeats).toBe(32);
  });

  it("a logged createTrack seeds its clip at the length the project had when it ran", () => {
    const { log } = seeded();
    log.dispatch({ type: "setLength", lengthBeats: 32 });
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-2" });
    const logged = log.getEntries().at(-1)!.command;

    const longer = seeded().project;
    longer.setLength(128);
    applyEdit(longer, logged, "you");

    expect(longer.getClipStore("t-2")?.getClip().lengthBeats).toBe(32);
  });

  // Audio is not time-stretched (DAW-35), so a placement's length is its duration at the tempo of
  // the moment. The same logged command at another tempo used to lay out a different region.
  it("a logged audio placement keeps the length it was laid out at", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "setTempo", bpm: 120 });
    log.dispatch({ type: "addAudioTrack", id: "t-a", fileId: "f-1", durationSec: 4 });
    const logged = log.getEntries().at(-1)!.command;

    const faster = new ProjectStore(false);
    faster.setTempo(180);
    applyEdit(faster, logged, "you");

    expect(faster.getTrack("t-a")?.placements[0]?.length).toBe(project.getTrack("t-a")?.placements[0]?.length);
  });

  it("refuses a colliding id rather than renaming it to one nobody can predict", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "addClip", trackId: "t-1", id: "c-2", empty: true });

    expect(project.getTrack("t-1")?.clips.map((clip) => clip.id)).toEqual(["c-t-1", "c-2"]);
  });

  // Replay MINUS an edit is the case the rebuild path (DAW-34 stage C) depends on: dropping the
  // clip that was active at the time must not silently redirect the note into another one.
  it("does not redirect a note edit when an earlier entry is excluded", () => {
    const { log } = seeded();
    log.dispatch({ type: "addNote", trackId: "t-1", note: note("n-1") });

    const withoutTheClip = log.getEntries().filter((entry) => entry.command.type !== "addClip");
    const rebuilt = new ProjectStore(false);
    for (const entry of withoutTheClip) applyEdit(rebuilt, entry.command, entry.author);

    // c-2 never existed in this rebuild, so the note has nowhere to go - and lands nowhere, rather
    // than in the seed clip it was never aimed at.
    expect(rebuilt.getClipStore("t-1", "c-t-1")?.getClip().notes).toHaveLength(0);
  });
});
