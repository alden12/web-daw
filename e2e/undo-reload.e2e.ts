import { test, expect, type Page } from "@playwright/test";

/**
 * Undo survives a reload: the undo/redo stacks are persisted to the bundle, so an
 * edit made before a refresh can still be undone after it.
 */

test.use({ viewport: { width: 1320, height: 900 } });

async function dismissStart(page: Page) {
  const start = page.getByRole("button", { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

const arr = (page: Page) => page.getByTestId("arr-scroll");

test("an edit can be undone after a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Rename a track, an undoable edit that shows in the arrangement.
  await page.getByTitle("Double-click to rename").first().dblclick();
  const input = page.locator("input:focus");
  await input.fill("Zeta");
  await input.press("Enter");
  await expect(arr(page).getByText("Zeta", { exact: true })).toBeVisible();

  await page.waitForTimeout(500); // let the debounced save + undo persist flush
  await page.reload();
  await dismissStart(page);
  await expect(arr(page).getByText("Zeta", { exact: true })).toBeVisible(); // persisted

  // Undo after the reload reverts the rename (undo/redo live in the panel's main menu).
  await page.getByRole("button", { name: "Project menu" }).click();
  await page.getByRole("menuitem", { name: "Undo" }).click();
  await expect(arr(page).getByText("Zeta", { exact: true })).toHaveCount(0);
});
