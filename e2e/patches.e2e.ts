import { test, expect, type Page } from "@playwright/test";

/**
 * Patches: save the selected instrument track (its instrument + params + effect
 * chain) as a named entry in the library, then add a new track from it. The patch
 * library is global (localStorage), so it shows up in the Patches rail view
 * across projects.
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

  // Open the Patches rail view - empty state until something is saved.
  await page.getByRole("button", { name: "Patches" }).click();
  await expect(page.getByText(/Save an instrument as a patch/)).toBeVisible();

  // Save the selected (seed) track as a patch.
  await page.getByRole("button", { name: "Save as patch" }).click();
  await page.getByPlaceholder("Patch name…").fill("Brass Pluck");
  await page.getByPlaceholder("Patch name…").press("Enter");

  // It appears in the Patches view.
  const patchEntry = page.getByRole("button", { name: "Brass Pluck", exact: true });
  await expect(patchEntry).toBeVisible();

  // The row's "+" adds it as a new track (the row's primary click applies to the
  // current track instead - covered by the audition test below).
  await page.getByRole("button", { name: 'Add "Brass Pluck" as a new track' }).click();
  await expect(trackHeaders).toHaveCount(before + 1);

  // The patch survives a reload (it is global, not part of the project bundle).
  await page.reload();
  await dismissStart(page);
  await expect(page.getByRole("button", { name: "Brass Pluck", exact: true })).toBeVisible();
});

test("expand an instrument to reveal its factory patches and add one", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();

  // The Instruments view (the default) lists Nimbus with a disclosure since it ships
  // factory patches. (Don't click the Instruments rail - it is already active, and
  // clicking the active rail icon collapses the panel.)
  const warmStrings = page.getByRole("button", { name: "Warm Strings", exact: true });
  await expect(warmStrings).toHaveCount(0); // collapsed by default - no clutter

  await page.getByRole("button", { name: "Expand Nimbus presets" }).click();
  await expect(warmStrings).toBeVisible();

  // The nested patch's "+" adds it as a new track.
  await page.getByRole("button", { name: 'Add "Warm Strings" as a new track' }).click();
  await expect(trackHeaders).toHaveCount(before + 1);
});

test("clicking a patch applies it to the selected track (audition), no new track", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();
  // The seed track is a subtractive synth.
  await expect(page.getByRole("tablist").getByText("subtractive", { exact: true })).toBeVisible();

  // Applying a Nimbus factory patch (primary click) changes the selected track in
  // place - its kind chip becomes nimbus - and does NOT add a track.
  await page.getByRole("button", { name: "Expand Nimbus presets" }).click();
  await page.getByRole("button", { name: "Warm Strings", exact: true }).click();
  await expect(page.getByRole("tablist").getByText("nimbus", { exact: true })).toBeVisible();
  await expect(trackHeaders).toHaveCount(before);
});
