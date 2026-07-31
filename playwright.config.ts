import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end / integration tests. These exercise the real app in a browser -
 * layout, panel resizing, persistence, MCP-driven flows - the things unit tests
 * (Vitest, in `test/`) can't reach. E2E specs are named `*.e2e.ts` so Vitest
 * (which matches `*.test.ts` / `*.spec.ts`) never tries to run them.
 */
/**
 * Deliberately well clear of 517x. The `apm` roadmap viewer binds 5179 and *wanders* to
 * the next free port in that range when it restarts, and `reuseExistingServer` below
 * adopts whatever is already listening without checking what it is. Running `open_viewer`
 * and `yarn test:e2e` in the same session then silently tests the roadmap viewer instead
 * of the app: every locator misses and the failures point nowhere near the cause.
 */
const PORT = 4319;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // `--mode test` loads `.env.test`, which blanks the auth + remote vars so a local `.env` can't
    // flip the login gate on and strand every test at the sign-in screen (no more moving `.env` aside).
    command: `yarn dev --port ${PORT} --mode test`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
