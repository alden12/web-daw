import { test, expect, type Page } from "@playwright/test";

/**
 * The version timeline (Activity rail view -> Versions tab): save named versions of
 * the commit DAG, see a commit's semantic diff, and revert to one. Each edit here
 * is an inline track rename, so the diffs are predictable.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

async function renameTrack(page: Page, to: string) {
  await page.getByTitle("Double-click to rename").first().dblclick();
  const input = page.locator("input:focus"); // the autofocused inline-rename field
  await input.fill(to);
  await input.press("Enter");
}

/** Open the Activity rail view (where the activity feed + Versions tab live). */
async function openActivity(page: Page) {
  await page.getByRole("button", { name: "Activity", exact: true }).click();
}

test("save versions, view a diff, and revert", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await renameTrack(page, "Bass"); // an edit -> something to commit

  await openActivity(page);
  await page.getByRole("combobox", { name: "Activity view" }).selectOption("versions");
  const name = page.getByPlaceholder("Name this version…");
  await name.fill("first");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("first", { exact: true })).toBeVisible();

  await renameTrack(page, "Lead"); // a second, distinct edit
  await name.fill("second");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("second", { exact: true })).toBeVisible();

  // Expand "second" -> its diff names the rename.
  await page.getByText("second", { exact: true }).click();
  await expect(page.getByText(/renamed to "Lead"/)).toBeVisible();

  // Revert to it -> a new "Revert to ..." version lands on top.
  await page.getByRole("button", { name: /Revert to this version/ }).click();
  await expect(page.getByText('Revert to "second"')).toBeVisible();
});

test("a saved version shows as a marker in the activity feed", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await renameTrack(page, "Verse");
  await openActivity(page);
  await page.getByRole("combobox", { name: "Activity view" }).selectOption("versions");
  await page.getByPlaceholder("Name this version…").fill("verse idea");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Back in the activity feed, the save appears inline among the edits.
  await page.getByRole("combobox", { name: "Activity view" }).selectOption("activity");
  await expect(page.getByText(/saved · verse idea/)).toBeVisible();
});

test("a commit marker carries its time and a way back to that version (DAW-8.14)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await renameTrack(page, "Verse");
  await openActivity(page);
  await page.getByRole("combobox", { name: "Activity view" }).selectOption("versions");
  await page.getByPlaceholder("Name this version…").fill("verse idea");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("verse idea", { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Activity view" }).selectOption("activity");
  const marker = page.getByRole("button", { name: /saved · verse idea/ });
  await expect(marker).toBeVisible();
  // The time the Versions tab has always shown, on the marker that had neither.
  await expect(marker).toContainText("just now");

  // Pressing the marker offers the action rather than taking it: a revert you tapped by accident
  // is exactly the thing this should not make easy.
  await marker.click();
  await page.getByRole("button", { name: /Revert to this version/ }).click();

  // Reverting records a new version rather than erasing anything, so it lands as its own marker.
  await expect(page.getByRole("button", { name: /saved · Revert to "verse idea"/ })).toBeVisible();
});

test("an edit says whether it is in a named version yet (DAW-8.4)", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await renameTrack(page, "Verse");
  await openActivity(page);
  // Nothing has been named, so the edit is not in a version - regardless of the auto checkpoint
  // that lands a few seconds later, which is plumbing and deliberately not counted.
  const row = page.getByTitle("You · Not saved in a version yet").first();
  await expect(row).toBeVisible();
  // Every row carries its own time, not just the commit markers.
  await expect(row).toContainText("just now");

  await page.getByRole("combobox", { name: "Activity view" }).selectOption("versions");
  await page.getByPlaceholder("Name this version…").fill("verse idea");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("combobox", { name: "Activity view" }).selectOption("activity");

  // Now it is, and a later edit is not.
  await expect(page.getByTitle("You · Saved in a version").first()).toBeVisible();
  await renameTrack(page, "Lead");
  await expect(page.getByTitle("You · Not saved in a version yet").first()).toBeVisible();
});
