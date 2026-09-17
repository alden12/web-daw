import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * Small UX affordances: Space toggles the transport from anywhere (outside text
 * fields). (The effect-chain add-effect button was removed; adding effects from the
 * UI is being reworked, so that flow has no e2e for now - MCP add_effect still
 * covers the model in test/mcp.test.ts.)
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("space toggles play/stop", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const play = page.getByRole("button", { name: /Play/ });
  await expect(play).toBeEnabled(); // audio started -> transport is usable
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /Play/ })).toBeVisible();
});
