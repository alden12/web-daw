import { describe, expect, it } from "vitest";
import { validateBundleFile } from "../server/api/bundleSchemas";
import { ProjectStore } from "../src/audio/project/projectStore";

describe("validateBundleFile", () => {
  it("accepts a real default project snapshot (guards against over-strict schemas)", () => {
    const snapshot = new ProjectStore().snapshot();
    expect(validateBundleFile("project.json", snapshot)).toEqual({ ok: true });
  });

  it("accepts well-formed manifest / meta / refs / commit / log / notes", () => {
    expect(validateBundleFile("manifest.json", { formatVersion: 1, projectId: "p1", projectSchema: 9 }).ok).toBe(true);
    expect(validateBundleFile("meta.json", { name: "X", modifiedAt: "2026-01-01T00:00:00.000Z" }).ok).toBe(true);
    expect(validateBundleFile("history/refs.json", { head: "c1", branches: { main: "c1", scratch: null } }).ok).toBe(
      true,
    );
    expect(validateBundleFile("history/commits/c1.json", { id: "c1", parent: null, entries: [] }).ok).toBe(true);
    expect(validateBundleFile("log.json", [{ seq: 1, time: 0 }]).ok).toBe(true);
    expect(validateBundleFile("notes.json", []).ok).toBe(true);
  });

  it("rejects wrong-shaped documents", () => {
    expect(validateBundleFile("project.json", { tracks: "nope" }).ok).toBe(false);
    expect(validateBundleFile("project.json", 123).ok).toBe(false);
    expect(validateBundleFile("manifest.json", { projectId: "p1" }).ok).toBe(false); // missing the numbers
    expect(validateBundleFile("log.json", [{ nope: true }]).ok).toBe(false); // entries need seq + time
    expect(validateBundleFile("history/commits/c1.json", { id: 5, entries: [] }).ok).toBe(false); // id not a string
  });

  it("passes unmodeled JSON paths through (still valid JSON, and never read by the app)", () => {
    expect(validateBundleFile("whatever.json", { anything: true }).ok).toBe(true);
  });
});
