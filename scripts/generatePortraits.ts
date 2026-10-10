/**
 * Regenerate the built-ins' Explore portraits (COMM-1.9.2): `yarn portraits`.
 *
 * Portraits are drawn from a real render of each device, and that needs AudioWorklets, so a real
 * browser: this starts the Vite dev server, opens it in headless Chromium, calls the dev-only
 * `window.__dawRenderPortraits` hook (`audio/engine/renderHarness.ts`), and writes what comes back to
 * `src/ui/explore/portraits.json`. That file is committed, so the app draws portraits on load without
 * rendering anything. Run it after adding or retuning a built-in; `test/portraits.test.ts` fails
 * until every built-in has one.
 */
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const OUTPUT = "src/ui/explore/portraits.json";

// `test` mode loads `.env.test`, which blanks sign-in and sync, so the page comes up local-only.
const server = await createServer({ mode: "test", server: { port: 5198, strictPort: false }, logLevel: "warn" });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5198/";
const browser = await chromium.launch();

try {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForFunction(() => "__dawRenderPortraits" in window, undefined, { timeout: 30_000 });
  const portraits = await page.evaluate(() =>
    (window as unknown as { __dawRenderPortraits: () => Promise<Record<string, unknown>> }).__dawRenderPortraits(),
  );
  await writeFile(OUTPUT, `${JSON.stringify(portraits, null, 2)}\n`);
  execFileSync("npx", ["prettier", "--write", OUTPUT], { stdio: "ignore" });
  console.log(`Wrote ${Object.keys(portraits).length} portraits to ${OUTPUT}`);
} finally {
  await browser.close();
  await server.close();
}
