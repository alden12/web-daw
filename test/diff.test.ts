import { describe, expect, it } from "vitest";
import { diffProjects } from "../src/audio/commands/diff";
import type { ProjectData } from "../src/audio/project/types";

/** A tiny one-instrument-track project, tweakable per test. */
function base(): ProjectData {
  return {
    groups: [],
    tempoBpm: 120,
    lengthBeats: 16,
    selectedTrackId: null,
    tracks: [
      {
        kind: "instrument",
        id: "t-1",
        name: "Lead",
        parentId: "master",
        muted: false,
        volume: 1,
        instrumentType: "subtractive",
        params: { "filter.cutoff": 400 },
        effects: [],
        clips: [{ id: "c-1", name: "A", author: "you", notes: [], lengthBeats: 16 }],
        placements: [],
        activeClipId: "c-1",
        launchedClipId: null,
      },
    ],
  } as unknown as ProjectData;
}

describe("diffProjects", () => {
  it("reports tempo, param, and note-count changes in musical terms", () => {
    const from = base();
    const to = base();
    to.tempoBpm = 128;
    (to.tracks[0] as { params: Record<string, number> }).params["filter.cutoff"] = 800;
    (to.tracks[0] as { clips: { notes: unknown[] }[] }).clips[0].notes = [{}, {}, {}, {}];

    const lines = diffProjects(from, to);
    expect(lines).toContain("Tempo 120 -> 128 BPM");
    expect(lines).toContain("Lead: filter.cutoff 400 -> 800");
    expect(lines).toContain('Lead: clip "A" 0 -> 4 notes');
  });

  it("reports added and removed tracks", () => {
    const from = base();
    const to = base();
    to.tracks.push({ ...(base().tracks[0] as object), id: "t-2", name: "Bass" } as never);
    expect(diffProjects(from, to)).toContain('+ Track "Bass"');
    expect(diffProjects(to, from)).toContain('- Track "Bass"');
  });

  it("is empty when nothing changed", () => {
    expect(diffProjects(base(), base())).toEqual([]);
  });
});
