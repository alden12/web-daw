import { test, expect, type Page } from '@playwright/test';

/**
 * Edit-log persistence: an authored edit shows in the agent-pane activity feed,
 * and the feed survives a reload (the log is persisted alongside the project
 * snapshot). Mirrors the other reload-persist specs.
 */

async function dismissStart(page: Page) {
  const start = page.getByRole('button', { name: /start audio/i });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0); // wait for the start overlay to clear (engine.start awaits worklets)
  }
}

test('the activity feed records an edit and survives a reload', async ({ page }) => {
  await page.goto('/');
  await dismissStart(page);

  // Add a clip -> one authored "New clip" entry in the feed.
  await page.getByRole('button', { name: '+ Clip' }).click();
  await expect(page.getByText(/New clip/)).toBeVisible();

  await page.waitForTimeout(400); // let the debounced autosave (project + log) flush
  await page.reload();
  await dismissStart(page);

  // The feed repopulated from the persisted log.
  await expect(page.getByText(/New clip/)).toBeVisible();
});
