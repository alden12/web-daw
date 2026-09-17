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
