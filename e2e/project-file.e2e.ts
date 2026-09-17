import { test, expect, type Page } from "@playwright/test";

/**
 * Portable .daw.zip export/import (from the library's project menu): export
 * downloads the whole project as a zip; importing it replaces the live project in
 * place. We export the seed, add a placement so the live state differs, then
 * import the exported file and confirm the project is restored to what was exported.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

const placements = (page: Page) => page.getByTestId("placement");

async function zoomOut(page: Page) {
  const btn = page.getByTitle("Zoom out", { exact: true });
  for (let i = 0; i < 3; i++) await btn.click();
}

test("export then import a .daw file restores the project", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);
  await zoomOut(page);

  await expect(placements(page)).toHaveCount(1); // the seed placement

  // Export the seed project (one placement) from the Project view's switcher menu.
  await page.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("button", { name: "Project menu" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export project…" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("project.daw.zip");
  const file = await download.path();

  // Change the live project: drag the empty lane to create + place a 2nd clip.
  const seed = (await placements(page).first().boundingBox())!;
  const y = seed.y + seed.height / 2;
  await page.mouse.move(seed.x + seed.width + 40, y);
  await page.mouse.down();
  await page.mouse.move(seed.x + seed.width + 160, y, { steps: 8 });
  await page.mouse.up();
  await expect(placements(page)).toHaveCount(2);

  // Import the earlier export -> the project is replaced with the one-placement state.
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(file);
  await expect(placements(page)).toHaveCount(1);
});
