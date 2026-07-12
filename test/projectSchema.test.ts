import { describe, expect, it } from "vitest";
import { projectDataSchema, validateBundleFile } from "../src/audio/project/schema";
import { ProjectStore } from "../src/audio/project/projectStore";

// A fully-populated instrument track, exercising the deep tree (chain + clips + placements).
const instrumentTrack = {
  id: "t1",
  name: "Lead",
  parentId: "g1",
  muted: false,
  solo: false,
  volume: 0.8,
  kind: "instrument",
  instrumentType: "wavetable",
  params: { cutoff: 1200, wave: "saw", loop: true },
  effects: [{ id: "e1", type: "reverb", bypassed: false, params: { mix: 0.3 } }],
  midiDevices: [],
  clips: [
    {
      id: "c1",
      name: "A",
      author: "you",
      notes: [{ id: "n1", pitch: 60, start: 0, length: 1, velocity: 0.9 }],
      lengthBeats: 4,
    },
  ],
  placements: [{ id: "pl1", clipId: "c1", startBeat: 0, offset: 0, length: 4 }],
  activeClipId: "c1",
  launchedClipId: null,
};

const DEEP_PROJECT = {
  groups: [
    { id: "g1", name: "Group", parentId: null, collapsed: false, muted: false, solo: false, volume: 1, effects: [] },
  ],
  tracks: [instrumentTrack],
  tempoBpm: 120,
  lengthBeats: 16,
  selectedTrackId: "t1",
};

const fullCommit = {
  id: "c1",
  parent: null,
  author: "you",
  message: "Initial",
  time: 0,
  auto: true,
  entryCount: 0,
  entries: [],
  lastSeq: 0,
};

describe("projectDataSchema", () => {
  it("accepts a real default project snapshot (guards against over-strict schemas)", () => {
    const snapshot = new ProjectStore().snapshot();
    expect(projectDataSchema.safeParse(snapshot).success).toBe(true);
    expect(validateBundleFile("project.json", snapshot)).toEqual({ ok: true });
  });

  it("accepts a deeply-populated project tree", () => {
    expect(validateBundleFile("project.json", DEEP_PROJECT).ok).toBe(true);
  });

  it("accepts an embedded custom-device def (reuses the graph def schema)", () => {
    const withCustom = {
      ...DEEP_PROJECT,
      deviceFormatVersion: 1,
      customInstruments: [{ type: "myVoice", schema: [], voice: { nodes: [], connections: [] } }],
    };
    expect(validateBundleFile("project.json", withCustom).ok).toBe(true);
  });

  it("deep-validates the tree the old shallow schema let through", () => {
    // non-array tracks
    expect(validateBundleFile("project.json", { ...DEEP_PROJECT, tracks: "nope" }).ok).toBe(false);
    // track missing its `kind` discriminant
    expect(validateBundleFile("project.json", { ...DEEP_PROJECT, tracks: [{ id: "t1" }] }).ok).toBe(false);
    // a malformed placement (missing fields)
    const badPlacement = { ...instrumentTrack, placements: [{ id: "pl1" }] };
    expect(validateBundleFile("project.json", { ...DEEP_PROJECT, tracks: [badPlacement] }).ok).toBe(false);
    // non-numeric tempo
    expect(validateBundleFile("project.json", { ...DEEP_PROJECT, tempoBpm: "fast" }).ok).toBe(false);
    // missing the required selection field
    const noSelection = { groups: DEEP_PROJECT.groups, tracks: DEEP_PROJECT.tracks, tempoBpm: 120, lengthBeats: 16 };
    expect(validateBundleFile("project.json", noSelection).ok).toBe(false);
  });
});

describe("validateBundleFile (other bundle docs)", () => {
  it("accepts well-formed manifest / meta / refs / commit / log / notes", () => {
    expect(validateBundleFile("manifest.json", { formatVersion: 1, projectId: "p1", projectSchema: 9 }).ok).toBe(true);
    expect(validateBundleFile("meta.json", { name: "X", modifiedAt: "2026-01-01T00:00:00.000Z" }).ok).toBe(true);
    expect(validateBundleFile("history/refs.json", { head: "c1", branches: { main: "c1", scratch: null } }).ok).toBe(
      true,
    );
    expect(validateBundleFile("history/commits/c1.json", fullCommit).ok).toBe(true);
    expect(validateBundleFile("log.json", [{ seq: 1, command: { type: "addNote" }, author: "you", time: 0 }]).ok).toBe(
      true,
    );
    expect(validateBundleFile("notes.json", []).ok).toBe(true);
  });

  it("rejects wrong-shaped documents", () => {
    expect(validateBundleFile("manifest.json", { projectId: "p1" }).ok).toBe(false); // missing the numbers
    expect(validateBundleFile("log.json", [{ nope: true }]).ok).toBe(false); // entries need seq + command + author + time
    expect(validateBundleFile("history/commits/c1.json", { id: 5, entries: [] }).ok).toBe(false); // id not a string, missing fields
    expect(validateBundleFile("history/commits/c1.json", { ...fullCommit, author: "someone-else" }).ok).toBe(false); // bad author enum
  });

  it("passes unmodeled JSON paths through (still valid JSON, and never read by the app)", () => {
    expect(validateBundleFile("whatever.json", { anything: true }).ok).toBe(true);
  });
});
