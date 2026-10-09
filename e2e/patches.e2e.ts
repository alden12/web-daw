import { test, expect } from "@playwright/test";
import { dismissStart, openExploreCategory } from "./support/app";

/**
 * Patches: save the selected instrument track (its instrument + params + effect
 * chain) as a named entry in the library, then add a new track from it. The patch
 * library is global (localStorage), so it shows up on Explore's Patches
 * page across projects.
 */

test.use({ viewport: { width: 1320, height: 900 } });

test("save an instrument as a patch, then add a track from it", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();

  // Open the Patches page: factory presets only until something is saved.
  await openExploreCategory(page, "Patches");
  const patchEntry = page.getByRole("button", { name: "Brass Pluck", exact: true });
  await expect(patchEntry).toHaveCount(0);

  // Save the selected (seed) track as a patch.
  await page.getByRole("button", { name: "Save as patch" }).click();
  await page.getByPlaceholder("Patch name…").fill("Brass Pluck");
  await page.getByPlaceholder("Patch name…").press("Enter");

  // It appears on the Patches page.
  await expect(patchEntry).toBeVisible();

  // The row's "+" adds it as a new track (the row's primary click applies to the
  // current track instead - covered by the audition test below).
  await page.getByRole("button", { name: 'Add "Brass Pluck" as a new track' }).click();
  await expect(trackHeaders).toHaveCount(before + 1);

  // The patch survives a reload (it is global, not part of the project bundle), and so
  // does the page Explore was left on.
  await page.reload();
  await dismissStart(page);
  await expect(page.getByRole("button", { name: "Brass Pluck", exact: true })).toBeVisible();
});

test("a factory patch adds as a new track from its +", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  const trackHeaders = page.getByTitle("Double-click to rename");
  const before = await trackHeaders.count();

  await openExploreCategory(page, "Patches");
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
  await openExploreCategory(page, "Patches");
  await page.getByRole("button", { name: "Warm Strings", exact: true }).click();
  await expect(page.getByRole("tablist").getByText("nimbus", { exact: true })).toBeVisible();
  await expect(trackHeaders).toHaveCount(before);
});

test("tag chips narrow a category together, and search finds by #tag (COMM-1.9.1)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await openExploreCategory(page, "Patches");
  await page.getByRole("group", { name: "Filter by tag" }).getByRole("button", { name: "#pad", exact: true }).click();
  await expect(page.getByRole("button", { name: "Glass Pad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deep Sub", exact: true })).toHaveCount(0);

  // Tags narrow together: the row re-ranks to what goes with #pad, and a second pick refines it.
  await page.getByRole("group", { name: "Filter by tag" }).getByRole("button", { name: "#airy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Glass Pad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Warm Strings", exact: true })).toHaveCount(0);

  // "More tags" has every tag on the page, grouped, beyond the short ranked row.
  await page.getByRole("button", { name: "More tags" }).click();
  await expect(page.getByRole("group", { name: "All tags" }).getByRole("button", { name: "#gritty" })).toBeVisible();

  await page.getByRole("button", { name: "Back to Explore" }).click();
  await page.getByRole("searchbox", { name: "Search Explore" }).fill("#space");
  await expect(page.getByRole("button", { name: "Reverb", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delay", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chorus", exact: true })).toHaveCount(0);
});
