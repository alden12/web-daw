import { test, expect, type Page } from "@playwright/test";

/**
 * The Project view is a project explorer: a tree of the current project's tracks.
 * Selecting a track drives the workbench (selection is one shared value); expanding
 * a track reveals compact mixer controls (mute/solo/gain). A switcher menu at the
 * top moves between projects (covered in activity-rail.e2e).
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
}

const openProjects = (page: Page) => page.getByRole("button", { name: "Projects" }).click();

test("expanding a track in the tree reveals mixer controls and toggles mute", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjects(page);

  // The seed track shows as a tree row; expand it to reveal its controls.
  await expect(page.getByTestId("tree-track")).toHaveCount(1);
  await page.getByRole("button", { name: "Expand track" }).first().click();

  // Mute via the inline control -> the button flips to "Unmute". Scope to the panel:
  // the timeline mixer has its own Mute buttons.
  const panel = page.locator('[class*="grid-area:library"]');
  await panel.getByTitle("Mute").click();
  await expect(panel.getByTitle("Unmute")).toBeVisible();
});

test("selecting a track in the tree selects it in the workbench", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Instruments is the default view; add a Sampler track (it becomes selected, so the
  // workbench tab's kind chip = sampler).
  await page.getByRole("button", { name: "Sampler", exact: true }).click();
  await expect(page.getByRole("tablist").getByText("sampler", { exact: true })).toBeVisible();

  // In the project tree, select the seed (subtractive) track -> the workbench follows.
  await openProjects(page);
  await page.getByTestId("tree-track").filter({ hasText: "subtractive" }).click();
  await expect(page.getByRole("tablist").getByText("subtractive", { exact: true })).toBeVisible();
});
