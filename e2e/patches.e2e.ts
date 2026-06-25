import { test, expect, type Page } from "@playwright/test";

/**
 * Patches: save the selected instrument track (its instrument + params + effect
 * chain) as a named entry in the library, then add a new track from it. The patch
 * library is global (localStorage), so it shows up in the Instruments > Patches
 * tree across projects.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

test("save an instrument as a patch, then add a track from it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();

  // Empty state until something is saved.
  await expect(page.getByText("Save an instrument as a patch to reuse it here.")).toBeVisible();

  // Save the selected (seed) track as a patch.
  await page.getByRole("button", { name: "Save as patch" }).click();
  await page.getByPlaceholder("Patch name…").fill("Brass Pluck");
  await page.getByPlaceholder("Patch name…").press("Enter");

  // It appears under Instruments > Patches.
  const patchEntry = page.getByRole("button", { name: "Brass Pluck", exact: true });
  await expect(patchEntry).toBeVisible();

  // Adding from the patch creates a new track.
  await patchEntry.click();
  await expect(trackHeaders).toHaveCount(before + 1);

  // The patch survives a reload (it is global, not part of the project bundle).
  await page.reload();
  await dismissStart(page);
  await expect(page.getByRole("button", { name: "Brass Pluck", exact: true })).toBeVisible();
});
