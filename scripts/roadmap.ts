/**
 * Roadmap CLI: `yarn roadmap:list` (print the project map) / `yarn roadmap:check` (fail on invalid markers,
 * for CI). The parsing/validation logic lives in the Node-free `roadmapParse` module so the browser viewer
 * (tools/roadmap) can share it; this file only adds file IO + the CLI. See docs/DESIGN.md "Roadmap markers".
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DESIGN_PATH, STATUSES, parseMarkers, validate, areasOf } from "./roadmapParse";

// Re-export the pure API so `scripts/roadmap` stays the one import path for tests and tooling.
export * from "./roadmapParse";

function main(): void {
  const markdown = readFileSync(DESIGN_PATH, "utf8");
  const items = parseMarkers(markdown);
  const errors = validate(items);

  if (process.argv.includes("--check")) {
    if (!errors.length) {
      console.log(`roadmap: OK (${items.length} items across ${areasOf(items).length} areas).`);
      return;
    }
    console.error("roadmap: FAILED\n" + errors.map((error) => `  - ${error}`).join("\n"));
    process.exit(1);
  }

  for (const area of areasOf(items)) {
    console.log(`\n${area}`);
    for (const item of items.filter((candidate) => candidate.area === area)) {
      const icon = STATUSES[item.status]?.icon ?? "?";
      const deps = item.deps.length ? `  (deps: ${item.deps.join(", ")})` : "";
      console.log(`  ${icon} ${item.id.padEnd(9)} ${item.title}${deps}`);
    }
  }
  if (errors.length) {
    console.error("\n" + errors.length + " problem(s):\n" + errors.map((error) => `  - ${error}`).join("\n"));
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) main();
