import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end / integration tests. These exercise the real app in a browser -
 * layout, panel resizing, persistence, MCP-driven flows - the things unit tests
 * (Vitest, in `test/`) can't reach. E2E specs are named `*.e2e.ts` so Vitest
 * (which matches `*.test.ts` / `*.spec.ts`) never tries to run them.
 */
const PORT = 5179;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `yarn dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
