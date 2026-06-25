import { test, expect, type Page } from "@playwright/test";

/**
 * The metronome toggle in the transport (right of the tempo control): it flips
 * its pressed state and the preference survives a reload.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

test("the metronome toggle flips and persists across reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const metro = page.getByRole("button", { name: "Metronome" });
  await expect(metro).toHaveAttribute("aria-pressed", "false");

  await metro.click();
  await expect(metro).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await dismissStart(page);
  await expect(page.getByRole("button", { name: "Metronome" })).toHaveAttribute("aria-pressed", "true");
});
