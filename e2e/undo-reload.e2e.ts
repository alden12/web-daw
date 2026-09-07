import { test, expect, type Page } from "@playwright/test";

/**
 * Undo survives a reload: the undo/redo stacks are persisted to the bundle, so an
 * edit made before a refresh can still be undone after it.
 *
 * **Every test here makes several edits before reloading, and that is not incidental** (DAW-8.15).
 * The first save is always a keyframe, and for a long time the keyframe was the only thing that
 * wrote `undo.json` - so a test that made one edit and reloaded passed while the feature was
 * broken for every real session. What it missed is the second edit onwards, which take the append
 * branch. Keep the edits, or this file goes back to proving nothing.
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

/** Rename the first track, an undoable edit that shows in the arrangement. */
async function renameTrack(page: Page, to: string) {
  await page.getByTitle("Double-click to rename").first().dblclick();
  const input = page.locator("input:focus");
  await input.fill(to);
  await input.press("Enter");
  await expect(arr(page).getByText(to, { exact: true })).toBeVisible();
}

async function undo(page: Page) {
  await page.getByRole("button", { name: "Project menu" }).click();
  await page.getByRole("menuitem", { name: "Undo" }).click();
}

test("an edit can be undone after a reload", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  await renameTrack(page, "Zeta");

  await page.waitForTimeout(500); // let the debounced save + undo persist flush
  await page.reload();
  await dismissStart(page);
  await expect(arr(page).getByText("Zeta", { exact: true })).toBeVisible(); // persisted

  // Undo after the reload reverts the rename (undo/redo live in the panel's main menu).
  await undo(page);
  await expect(arr(page).getByText("Zeta", { exact: true })).toHaveCount(0);
});

test("undo after a reload takes back the LAST edit, not one from the first save", async ({ page }) => {
  await page.goto("/");
  await dismissStart(page);

  // Three edits with a save between each, so all but the first land on the append branch - the
  // one that used to leave undo.json frozen at the first keyframe.
  await renameTrack(page, "Alpha");
  await page.waitForTimeout(400);
  await renameTrack(page, "Beta");
  await page.waitForTimeout(400);
  await renameTrack(page, "Gamma");

  await page.waitForTimeout(500);
  await page.reload();
  await dismissStart(page);
  await expect(arr(page).getByText("Gamma", { exact: true })).toBeVisible();

  // One step back is "Beta". The bug's signature was landing much further back than this, because
  // a checkpoint restores a whole-project snapshot rather than inverting one command.
  await undo(page);
  await expect(arr(page).getByText("Beta", { exact: true })).toBeVisible();
  await expect(arr(page).getByText("Alpha", { exact: true })).toHaveCount(0);
});
