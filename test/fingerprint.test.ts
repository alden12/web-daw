import { describe, it, expect } from "vitest";
import { EditLog } from "../src/audio/commands/editLog";
import { fingerprintProject } from "../src/audio/project/fingerprint";
import { ProjectStore } from "../src/audio/project/projectStore";

describe("fingerprintProject", () => {
  it("survives the JSON round trip a snapshot takes through storage", () => {
    // The stamp is written to undo.json and compared against a project rebuilt from project.json, so
    // it has to mean the same thing on both sides of a serialize/parse (DAW-8.15).
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    log.dispatch({ type: "setTempo", bpm: 132 });

    const snapshot = project.snapshot();
    expect(fingerprintProject(JSON.parse(JSON.stringify(snapshot)))).toBe(fingerprintProject(snapshot));
  });

  it("changes when any part of the project changes", () => {
    const project = new ProjectStore(false);
    const log = new EditLog(project);
    log.dispatch({ type: "createTrack", instrumentType: "subtractive", id: "t-1" });
    const before = fingerprintProject(project.snapshot());

    log.dispatch({ type: "setTempo", bpm: 132 });
    expect(fingerprintProject(project.snapshot())).not.toBe(before);
  });
});
