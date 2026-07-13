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

test("add an empty track from a group, then assign it an instrument", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjects(page);

  // The "main" group's + button opens a menu; "New MIDI track" adds an empty
  // instrument track (no instrument yet); it is selected.
  await page.getByRole("button", { name: /Add a track to main/i }).click();
  await page.getByRole("menuitem", { name: "New MIDI track" }).click();
  await expect(page.getByRole("tablist").getByText("empty", { exact: true })).toBeVisible();
  await expect(page.getByText("This track has no instrument yet. Choose one:")).toBeVisible();

  // Picking an instrument assigns it - the tab's kind chip becomes that instrument.
  await page.getByRole("button", { name: "FM", exact: true }).click();
  await expect(page.getByRole("tablist").getByText("fm", { exact: true })).toBeVisible();
});

test("add an empty audio track from a group's + menu", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await openProjects(page);

  // The + menu's "New audio track" adds an empty audio track; it is selected and its
  // tab kind chip reads "audio", with the empty audio-clip panel in the workbench.
  await page.getByRole("button", { name: /Add a track to main/i }).click();
  await page.getByRole("menuitem", { name: "New audio track" }).click();
  await expect(page.getByRole("tablist").getByText("audio", { exact: true })).toBeVisible();
  await expect(page.getByText("No audio clip.")).toBeVisible();
});
