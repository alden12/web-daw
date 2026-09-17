import { test, expect } from "@playwright/test";
import { dismissStart } from "./support/app";

/**
 * The metronome toggle in the transport (right of the tempo control): it flips
 * its pressed state and the preference survives a reload.
 */

test.use({ viewport: { width: 1320, height: 900 } });

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
