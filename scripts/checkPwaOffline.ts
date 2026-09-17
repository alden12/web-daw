/**
 * Does the installed app actually start with no network? (MOBILE-3)
 *
 * This is the one claim the ticket makes, and the only place it can be checked is a real
 * browser against a real build. It cannot live in `e2e/`: that suite runs against the Vite dev
 * server, where the service worker is deliberately switched off so a stale bundle can never
 * serve a test. So it gets its own entry point, run in CI after `yarn build`.
 *
 * `yarn check:pwa`. Serves `dist/` on a throwaway port - localhost is a secure context, which
 * a service worker requires - installs the worker, cuts the network, and asks for a route the
 * browser has never seen.
 *
 * What it is really guarding is the pair of silent failures. A worker that registers but
 * precaches the wrong glob looks perfectly healthy right up until the network goes; and a
 * navigation fallback with no denylist answers `/api/...` with the app's own HTML, which is
 * worse than failing, because the app has handling for a network it cannot reach and none at
 * all for a 200 that is lying to it.
 */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = 5199;
const ORIGIN = `http://localhost:${PORT}`;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** The deploy's own arrangement: real files first, then `index.html` for client-side routes. */
function serveDist() {
  return createServer(async (request, response) => {
    const path = normalize(new URL(request.url ?? "/", ORIGIN).pathname);
    if (path.startsWith("/api/")) return void response.writeHead(503).end();
    for (const candidate of [join("dist", path), "dist/index.html"]) {
      try {
        const body = await readFile(candidate);
        response.writeHead(200, { "content-type": CONTENT_TYPES[extname(candidate)] ?? "application/octet-stream" });
        return void response.end(body);
      } catch {
        // Try the fallback.
      }
    }
    response.writeHead(404).end();
  });
}

const failures: string[] = [];
const check = (ok: boolean, description: string) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${description}`);
  if (!ok) failures.push(description);
};

const server = serveDist();
await new Promise<void>((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: "allow" });
const page = await context.newPage();

await page.goto(ORIGIN);
const worker = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? "");
check(worker.endsWith("/sw.js"), `a service worker installs and activates (${worker || "none"})`);

// `clientsClaim` is what makes this true without a reload, which is the difference between
// "offline works" and "offline works if you happened to load the page twice".
const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "");
check(controller.endsWith("/sw.js"), "and takes control of the page that installed it");

await context.setOffline(true);

// A route nobody has visited, so nothing but the navigation fallback can be answering.
await page.goto(`${ORIGIN}/p/never-visited-project`);
const rendered = await page.evaluate(() => document.querySelector("#root")?.childElementCount ?? 0);
check(rendered > 0, "offline, an unvisited client-side route still renders the app");

/**
 * The denylist, checked the only way it can be. `navigateFallback` applies to *navigation*
 * requests and nothing else, so a `fetch()` to the API never reaches it and would pass this
 * whether the denylist were there or not. A navigation to an API path does reach it: without
 * the denylist the worker answers with the app's own HTML and a 200.
 */
const apiNavigation = await page.goto(`${ORIGIN}/api/projects`).then(
  async (response) => ({ served: true, type: response?.headers()["content-type"] ?? "" }),
  () => ({ served: false, type: "" }),
);
check(
  !apiNavigation.served,
  `offline, an API path fails rather than being served the app's HTML (${apiNavigation.type || "not served"})`,
);

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} PWA check(s) failed.`);
  process.exit(1);
}
console.log("\nPWA offline checks passed.");
