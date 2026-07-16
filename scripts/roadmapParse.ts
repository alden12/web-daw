/**
 * Roadmap markers - pure parser. DESIGN.md is the single source of truth for the project map; features
 * carry an inline marker beside their prose (see the "Roadmap markers" section of docs/DESIGN.md):
 *
 *   `AREA-N` `status` Short title (deps: AREA-M, AREA-K)
 *
 * This module has NO Node dependencies so it can be shared by both the CLI (scripts/roadmap.ts, which
 * reads the file) and the browser viewer (tools/roadmap, which imports DESIGN.md via Vite's `?raw`).
 *
 * Status is a fixed vocabulary (below). Areas are open: the prefix of an id defines its area, and a new
 * prefix is picked up automatically - no central list to update.
 */
import { z } from "zod";

export const DESIGN_PATH = "docs/DESIGN.md";

/** The fixed status vocabulary, in workflow order (shipped -> back-of-queue). `icon` is the glyph the
 *  viewer/CLI show, `colour` is the hue the viewer uses when colouring by status, and `strike` marks a
 *  status whose title is struck through (a closed/complete item). */
export const STATUSES = {
  done: { icon: "✓", label: "done", colour: "#34d399", strike: true }, // green - shipped on main
  review: { icon: "◐", label: "review", colour: "#a884f3", strike: false }, // purple - built, in a PR
  "in-progress": { icon: "●", label: "in-progress", colour: "#4f9dff", strike: false }, // blue - being built now
  "to-do": { icon: "○", label: "to-do", colour: "#fbbf24", strike: false }, // yellow - ready to build
  planning: { icon: "○", label: "planning", colour: "#e8590c", strike: false }, // deep orange - still being shaped
} as const;
export type Status = keyof typeof STATUSES;
const statusSchema = z.enum(Object.keys(STATUSES) as [Status, ...Status[]]);

export interface RoadmapItem {
  id: string;
  area: string;
  status: Status;
  title: string;
  deps: string[];
  /** Parent ticket id for a nested (sub-)ticket, derived from a dotted id (`HOST-6.1` -> `HOST-6`); null for
   *  a top-level ticket. A ticket with children renders as a nested box in the viewer. */
  parent: string | null;
  /** 0-based line in DESIGN.md the marker sits on (for slicing its section). */
  line: number;
}

// A marker line: optional bullet, `AREA-N` (optionally dotted for nesting, e.g. `HOST-6.1`), `status`
// (lower-case, may be hyphenated like `in-progress`), title, optional trailing (deps: ...).
const MARKER = /^\s*(?:[-*]\s+)?`([A-Z]+-\d+(?:\.\d+)*)`\s+`([a-z-]+)`\s+(.+?)\s*$/;
const DEPS = /\s*\(deps:\s*([^)]*)\)\s*$/;

/** The parent ticket id of a dotted id, or null for a top-level id. `HOST-6.1` -> `HOST-6`; `HOST-6` -> null. */
export const parentOf = (id: string): string | null => (id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : null);

/** Every marker found in the doc, in document order. Unknown-status markers are still returned (with the
 *  raw status) so `validate` can report them, rather than silently dropping a typo. */
export function parseMarkers(markdown: string): RoadmapItem[] {
  const items: RoadmapItem[] = [];
  markdown.split("\n").forEach((text, line) => {
    const match = text.match(MARKER);
    if (!match) return;
    const [, id, status, rest] = match;
    const depsMatch = rest.match(DEPS);
    const deps = depsMatch
      ? depsMatch[1]
          .split(",")
          .map((dep) => dep.trim())
          .filter(Boolean)
      : [];
    const raw = depsMatch ? rest.slice(0, depsMatch.index).trim() : rest.trim();
    const title = raw.replace(/^\*\*(.+)\*\*$/, "$1").trim(); // allow a bold title (task-header style)
    items.push({ id, area: id.split("-")[0], status: status as Status, title, deps, parent: parentOf(id), line });
  });
  return items;
}

/** Problems with the markers (empty = valid): unknown status, duplicate id, a dep pointing at no id, or a
 *  nested (dotted) id whose parent ticket does not exist. */
export function validate(items: RoadmapItem[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of items) {
    if (!statusSchema.safeParse(item.status).success) {
      errors.push(`"${item.id}" has unknown status "${item.status}". Known: ${Object.keys(STATUSES).join(", ")}.`);
    }
    if (ids.has(item.id)) errors.push(`Duplicate id "${item.id}".`);
    ids.add(item.id);
  }
  for (const item of items) {
    for (const dep of item.deps) {
      if (!ids.has(dep)) errors.push(`"${item.id}" depends on unknown id "${dep}".`);
    }
    if (item.parent && !ids.has(item.parent)) {
      errors.push(`"${item.id}" is nested under unknown parent "${item.parent}".`);
    }
  }
  return errors;
}

/** The distinct areas present, in first-seen order (areas are open, so this is derived, not configured). */
export function areasOf(items: RoadmapItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) if (!seen.includes(item.area)) seen.push(item.area);
  return seen;
}

/**
 * The prose block a marker sits in, for the viewer's detail panel: from the nearest "header" at or above
 * it down to the next header of the same or higher rank. A header is a markdown heading (`#`..`######`,
 * rank = its level) OR a standalone bold line like `**Agent**` (rank 7, finer than any heading) - because
 * DESIGN.md's roadmap groups the forward work under bold sub-headers, not `###`. Slicing only on headers
 * keeps this robust: it never tries to interpret the prose, just bounds it.
 *
 * When several markers sit back-to-back (a run) they share the prose around them - a leading intro (like the
 * "shipped foundations" list) or a trailing block (a cluster describing several tickets at once). A marker
 * whose own block is just its line would otherwise show an empty description, so in that case we fall back to
 * the whole shared block: the run's leading intro + the run + its trailing prose.
 */
export function sectionAround(markdown: string, line: number): string {
  const lines = markdown.split("\n");
  const isBlank = (text: string): boolean => text.trim() === "";
  const rank = (text: string): number => {
    const heading = text.match(/^(#{1,6})\s/);
    if (heading) return heading[1].length;
    // A marker line or a standalone bold sub-header bounds a feature's block (rank 7, finer than headings),
    // so a per-feature marker's detail is just that feature's prose - up to the next marker/header.
    if (MARKER.test(text)) return 7;
    return /^\s*\*\*[^*].*\*\*\s*$/.test(text) ? 7 : 0;
  };

  let start = line;
  while (start > 0 && rank(lines[start]) === 0) start -= 1;
  const startRank = rank(lines[start]) || 7;
  let end = line + 1;
  while (end < lines.length) {
    const here = rank(lines[end]);
    if (here > 0 && here <= startRank) break;
    end += 1;
  }

  // If the marker's own block carries real prose, that is the detail.
  if (lines.slice(start + 1, end).some((text) => !isBlank(text))) return lines.slice(start, end).join("\n").trim();

  // Empty own block: this marker is one of a back-to-back run sharing prose. Widen to the run + the prose
  // directly before it (a leading intro) and after it (a trailing shared block), bounded by real headings.
  let runStart = start;
  for (let above = start - 1; above >= 0 && (isBlank(lines[above]) || MARKER.test(lines[above])); above -= 1) {
    if (MARKER.test(lines[above])) runStart = above;
  }
  let runEnd = end;
  while (runEnd < lines.length && (isBlank(lines[runEnd]) || MARKER.test(lines[runEnd]))) runEnd += 1;

  // Pull in a leading intro paragraph above the run (allowing the usual single blank line between an intro
  // and its list), stopping at a blank gap or a real header so unrelated prose isn't swept in.
  let blockStart = runStart;
  let above = runStart - 1;
  if (above >= 0 && isBlank(lines[above])) above -= 1;
  while (above >= 0 && !isBlank(lines[above]) && rank(lines[above]) === 0) {
    blockStart = above;
    above -= 1;
  }
  let blockEnd = runEnd; // pull in the trailing shared prose, up to the next real header
  while (blockEnd < lines.length && rank(lines[blockEnd]) === 0) blockEnd += 1;

  return lines.slice(blockStart, blockEnd).join("\n").trim();
}
