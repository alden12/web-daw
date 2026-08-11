import { describe, expect, it } from "vitest";
import { PROJECT_PATH_PREFIX, projectIdFromPath, projectPath, projectSlug } from "../src/ui/projectUrl";

/**
 * The link half of "a project has a URL". Pure, so the round trip is tested here and the e2e
 * only has to prove the browser is pointed at it.
 */
describe("projectSlug", () => {
  it("makes a name safe to paste into a URL", () => {
    expect(projectSlug("Deep House Jam")).toBe("deep-house-jam");
    expect(projectSlug("Take 2 (final!!)")).toBe("take-2-final");
  });

  it("is empty rather than wrong when a name has nothing to slug", () => {
    expect(projectSlug("!!!")).toBe("");
    expect(projectSlug("  ")).toBe("");
  });

  it("never ends in a hyphen, including when the cap lands on one", () => {
    // A truncated slug that ended in "-" would read as a missing word rather than a cut one.
    expect(projectSlug(`${"a".repeat(47)} bcdef`).endsWith("-")).toBe(false);
  });
});

describe("projectPath / projectIdFromPath", () => {
  it("round-trips an id, whatever the name does to the slug", () => {
    const cases: [string, string][] = [
      ["p-1a2b3c4d", "Deep House Jam"],
      ["default", "Untitled"],
      // Names that are all punctuation leave no slug at all, so the path is bare id.
      ["p-99887766", "!!!"],
      // A name that looks like a path, and one carrying the separator's neighbours.
      ["p-deadbeef", "a/b/c"],
      ["p-cafed00d", "Mix ~ v2"],
    ];
    for (const [id, name] of cases) {
      expect(projectIdFromPath(projectPath(id, name)), `${name} -> ${projectPath(id, name)}`).toBe(id);
    }
  });

  it("puts the readable half first, and keeps everything under one prefix", () => {
    expect(projectPath("p-1a2b3c4d", "Deep House Jam")).toBe("/p/deep-house-jam~p-1a2b3c4d");
    expect(projectPath("p-1a2b3c4d", "")).toBe("/p/p-1a2b3c4d");
    expect(projectPath("x", "y").startsWith(PROJECT_PATH_PREFIX)).toBe(true);
  });

  it("reads the id even when the name has been renamed out from under the link", () => {
    // The slug is decoration: a stale one still resolves, which is the point of carrying an id.
    expect(projectIdFromPath("/p/its-old-name~p-1a2b3c4d")).toBe("p-1a2b3c4d");
  });

  it("names no project where there is none to name", () => {
    expect(projectIdFromPath("/")).toBe(null);
    expect(projectIdFromPath("/settings")).toBe(null);
    expect(projectIdFromPath("/p/")).toBe(null);
  });
});
