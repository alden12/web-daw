import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseMarkers, validate, areasOf, sectionAround, STATUSES, DESIGN_PATH } from "../scripts/roadmap";

// Keeps the project map honest: every marker in DESIGN.md uses a known status, ids are unique, and deps
// resolve. Also covers the parser + the section-slicer the viewer's detail panel uses.
describe("roadmap markers", () => {
  const markdown = readFileSync(DESIGN_PATH, "utf8");

  it("DESIGN.md markers are all valid", () => {
    const items = parseMarkers(markdown);
    expect(validate(items)).toEqual([]);
    expect(items.length).toBeGreaterThan(30);
  });

  it("derives the current areas from the markers (open set, first-seen order)", () => {
    const areas = areasOf(parseMarkers(markdown));
    expect(new Set(areas)).toEqual(new Set(["DAW", "INST", "AGENT", "HOST", "COLLAB", "MOBILE", "ARCH"]));
  });

  it("parses id, status, title and deps from a marker line", () => {
    const [item] = parseMarkers("- `HOST-6` `review` B2 server-authoritative history (deps: HOST-5, HOST-4)");
    expect(item).toMatchObject({
      id: "HOST-6",
      area: "HOST",
      status: "review",
      title: "B2 server-authoritative history",
      deps: ["HOST-5", "HOST-4"],
    });
  });

  it("flags an unknown status, a duplicate id, and a dangling dep", () => {
    const errors = validate(
      parseMarkers(["- `DAW-1` `done` A", "- `DAW-1` `wat` B", "- `DAW-2` `to-do` C (deps: DAW-9)"].join("\n")),
    );
    expect(errors.some((error) => error.includes('unknown status "wat"'))).toBe(true);
    expect(errors.some((error) => error.includes('Duplicate id "DAW-1"'))).toBe(true);
    expect(errors.some((error) => error.includes('unknown id "DAW-9"'))).toBe(true);
  });

  it("every status has an icon (for the viewer)", () => {
    for (const meta of Object.values(STATUSES)) expect(meta.icon).toBeTruthy();
  });

  it("slices a per-feature marker to its own prose, bounded by the next marker", () => {
    const doc = [
      "**Agent**", // 0  <- parent group header
      "`AGENT-2` `in-progress` **In-app agent panel**", // 1  <- this feature's marker (header)
      "panel detail prose", // 2
      "`AGENT-4` `to-do` **Agent ears**", // 3  <- next feature's marker
      "ears detail", // 4
    ].join("\n");
    const section = sectionAround(doc, 1);
    expect(section).toContain("In-app agent panel"); // starts at its own header
    expect(section).toContain("panel detail prose"); // includes its prose
    expect(section).not.toContain("Agent ears"); // stops at the next feature's marker
    expect(section).not.toContain("**Agent**"); // and doesn't pull in the parent group header
  });
});
