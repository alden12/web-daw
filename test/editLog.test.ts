import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";

function setup() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  return { project, log };
}

describe("EditLog", () => {
  it("applies a command and records an authored, ordered entry", () => {
    const { project, log } = setup();
    log.dispatch({ type: "setTempo", bpm: 90 });
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" }, "claude");

    expect(project.tempo).toBe(90);
    expect(project.getTrack("t-1")?.kind).toBe("instrument");

    const { entries } = log.getState();
    expect(entries.map((e) => e.command.type)).toEqual(["setTempo", "createTrack"]);
    expect(entries.map((e) => e.author)).toEqual(["you", "claude"]);
    expect(entries.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("note() posts a feed annotation that is not an edit (stays out of the replay stream)", () => {
    const { log } = setup();
    log.dispatch({ type: "setTempo", bpm: 100 });
    log.note("building the demo", "claude");

    // The note shows in the feed but never in the replayable edit entries.
    expect(log.getNotes().map((n) => n.text)).toEqual(["building the demo"]);
    expect(log.getState().notes).toHaveLength(1);
    expect(log.getEntries().map((e) => e.command.type)).toEqual(["setTempo"]); // no note in here
    expect(log.getState().canUndo).toBe(true); // a note does not add an undo step
    // It interleaves by seq (after the tempo edit at seq 0).
    expect(log.getNotes()[0].seq).toBe(1);
  });

  it("describe() resolves a track id to its name", () => {
    const { log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "organ", id: "t-1" });
    log.dispatch({ type: "setParam", trackId: "t-1", id: "amp.level", value: 0.5 });
    const entries = log.getEntries();
    // organ's default-named track, resolved by describe (not just "Set amp.level").
    expect(log.describe(entries[1])).toContain("amp.level");
    expect(log.describe(entries[1])).toContain("Organ"); // name resolved via the project
  });

  it("undo/redo round-trips a structural edit", () => {
    const { project, log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-1" });
    expect(project.getTrack("t-1")).toBeTruthy();
    expect(log.getState().canUndo).toBe(true);

    log.undo();
    expect(project.getTrack("t-1")).toBeUndefined();
    expect(log.getState().canRedo).toBe(true);

    log.redo();
    expect(project.getTrack("t-1")?.instrumentType).toBe("fm");
  });

  it("a recorded MIDI take punches in over the lane, and undo restores what was beneath", () => {
    const { project, log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    project.removePlacement("t-1", "p-t-1"); // drop the auto-seeded placement for a clean lane
    project.addPlacement("t-1", { id: "p-old", startBeat: 0, length: 8 }); // seed clip beneath
    const lane = () => project.getStructure().tracks.find((t) => t.id === "t-1")!.placements;

    log.dispatch({
      type: "addNoteClip",
      trackId: "t-1",
      id: "c-take",
      placementId: "p-take",
      notes: [{ id: "n1", pitch: 60, start: 0, length: 1, velocity: 0.8 }],
      lengthBeats: 4,
      startBeat: 0,
    });
    // [0,4) of the seed clip is punched out; only the take + the [4,8) remnant remain.
    expect(
      lane()
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p-old", "p-take"]);
    expect(lane().find((p) => p.id === "p-old")!.startBeat).toBe(4);

    log.undo();
    const restored = lane();
    expect(restored.map((p) => p.id)).toEqual(["p-old"]);
    expect(restored[0].startBeat).toBe(0);
    expect(restored[0].length).toBe(8);
  });

  it("undo reverts a parameter change and a note edit", () => {
    const { project, log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });

    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 1234 });
    expect((project.getTrack("t-1") as { params: { get(id: string): unknown } }).params.get("filter.cutoff")).toBe(
      1234,
    );
    log.undo();
    expect((project.getTrack("t-1") as { params: { get(id: string): unknown } }).params.get("filter.cutoff")).toBe(
      4000,
    );

    log.dispatch({
      type: "addNote",
      trackId: "t-1",
      note: { id: "n-1", pitch: 60, start: 0, length: 1, velocity: 0.8 },
    });
    const clip = () => project.getClipStore("t-1")!.getClip().notes;
    expect(clip()).toHaveLength(1);
    log.undo();
    expect(clip()).toHaveLength(0);
  });

  it("undoes a cascading group removal in one step", () => {
    const { project, log } = setup();
    log.dispatch({ type: "createGroup", id: "g-1", name: "Drums" });
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1", groupId: "g-1" });
    expect(project.getTrack("t-1")?.parentId).toBe("g-1");

    log.dispatch({ type: "removeGroup", groupId: "g-1" });
    expect(project.getGroup("g-1")).toBeUndefined();
    expect(project.getTrack("t-1")).toBeUndefined();

    log.undo();
    expect(project.getGroup("g-1")?.name).toBe("Drums");
    expect(project.getTrack("t-1")?.parentId).toBe("g-1");
  });

  it("coalesces rapid edits to the same target into one step and one entry", () => {
    const { project, log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });

    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 1000 });
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 2000 });
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 3000 });

    const { entries } = log.getState();
    // createTrack + one coalesced setParam (not three)
    expect(entries).toHaveLength(2);
    const get = () => (project.getTrack("t-1") as { params: { get(id: string): unknown } }).params.get("filter.cutoff");
    expect(get()).toBe(3000);

    // a single undo reverts the whole drag back to the default
    log.undo();
    expect(get()).toBe(4000);
    expect(project.getTrack("t-1")).toBeTruthy(); // track still there
  });

  it("does not coalesce edits to different targets", () => {
    const { log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 1000 });
    log.dispatch({ type: "setParam", trackId: "t-1", id: "amp.level", value: 0.5 });
    expect(log.getState().entries.filter((e) => e.command.type === "setParam")).toHaveLength(2);
  });

  it("records undo and redo as activity entries (reflog style)", () => {
    const { log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });

    log.undo();
    let entries = log.getState().entries;
    expect(entries.at(-1)?.kind).toBe("undo");
    expect(entries.at(-1)?.label).toMatch(/^Undid:/);
    expect(entries.at(-1)?.author).toBe("you");

    log.redo();
    entries = log.getState().entries;
    expect(entries.at(-1)?.kind).toBe("redo");
    expect(entries.at(-1)?.label).toMatch(/^Redid:/);
    // edit + undo + redo = three feed entries; the edit is the original one.
    expect(entries.map((e) => e.kind)).toEqual(["edit", "undo", "redo"]);
  });

  it("clears the redo stack after a new edit", () => {
    const { log } = setup();
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-2" });
    log.undo();
    expect(log.getState().canRedo).toBe(true);
    log.dispatch({ type: "createTrack", instrumentType: "fm", id: "t-3" });
    expect(log.getState().canRedo).toBe(false);
  });
});
